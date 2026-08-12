import { app, BrowserWindow, screen, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import type {
  ApplyLayoutInput,
  CreateTemplateInput,
  CreateWorkspaceInput,
  DetectedWindow,
  DockApp,
  DwmPreviewResult,
  DwmPreviewWindow,
  EmbedResult,
  EmbedWindowParams,
  FocusWindowResult,
  LaunchResult,
  LayoutTemplate,
  MoveEmbeddedWindowParams,
  OverlayModeResult,
  RelayPointerInput,
  RelayPointerResult,
  RestoreResult,
  SavedWorkspace,
  WindowCommand,
  WindowCommandResult,
  WorkspaceRegion
} from '../shared/types';
import { readTemplates, writeTemplates, readWorkspaces, writeWorkspaces } from './storage';
import { listLocalDockApps, launchDockApp } from './dock-apps';
import { sendWindowControlCommand, stopWindowControlHost } from './window-control-client';
import { sendDwmPreviewCommand, stopDwmPreviewHost, recordDwmPreviewSync } from './dwm-preview-client';
import {
  normalizeEmbedBounds,
  recordEmbeddedWindow,
  hasEmbeddedWindow,
  getEmbeddedWindowCount,
  queueEmbeddedMove,
  detachEmbeddedWindow,
  detachAllEmbeddedWindows
} from './embedded-windows';
import { createWindow, fitBrowserWindowToDisplay } from './browser-window';
import { nativeWindowHandleToString } from './win32';
import { handleTrusted } from './security';

let overlayRestoreBounds: Rectangle | null = null;
let isQuittingAfterDetach = false;

app.disableHardwareAcceleration();
app.enableSandbox();
app.setAppUserModelId('com.infinitedesk.app');

function isBlankHwnd(hwnd: string | null | undefined): boolean {
  return !hwnd || hwnd.trim().length === 0;
}

function isRestorableWindow(windowInfo: DetectedWindow): boolean {
  return (
    windowInfo.isRestorable &&
    !windowInfo.isInternal &&
    windowInfo.x !== null &&
    windowInfo.y !== null &&
    windowInfo.width !== null &&
    windowInfo.height !== null
  );
}

function getControllerWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const controllerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!controllerWindow || controllerWindow.isDestroyed()) {
    return null;
  }

  return controllerWindow;
}

handleTrusted('windows:scan', async (): Promise<DetectedWindow[]> => {
  const result = await sendWindowControlCommand<DetectedWindow[] | DetectedWindow>('scan', {});
  return Array.isArray(result) ? result : [result];
});

handleTrusted('templates:list', async (): Promise<LayoutTemplate[]> => {
  return readTemplates();
});

handleTrusted('templates:create', async (_event, input: CreateTemplateInput): Promise<LayoutTemplate> => {
  const restorableWindows = input.windows.filter(isRestorableWindow);

  if (restorableWindows.length === 0) {
    throw new Error('No restorable windows selected.');
  }

  const now = new Date().toISOString();
  const template: LayoutTemplate = {
    id: crypto.randomUUID(),
    name: input.name.trim() || `Layout ${new Date().toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    windows: restorableWindows
  };

  const templates = await readTemplates();
  templates.unshift(template);
  await writeTemplates(templates);
  return template;
});

handleTrusted('templates:delete', async (_event, id: string): Promise<void> => {
  const templates = await readTemplates();
  await writeTemplates(templates.filter((template) => template.id !== id));
});

handleTrusted('workspaces:list', async (): Promise<SavedWorkspace[]> => {
  return readWorkspaces();
});

handleTrusted('workspaces:create', async (_event, input: CreateWorkspaceInput): Promise<SavedWorkspace> => {
  const workspaceWindows = input.windows.filter(isRestorableWindow);

  const workspaceRegions: WorkspaceRegion[] = input.regions.map((region) => ({
    id: region.id,
    name: region.name,
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.max(80, Math.round(region.width)),
    height: Math.max(60, Math.round(region.height)),
    windowIds: region.windowIds,
    color: region.color,
    createdAt: region.createdAt
  }));

  if (workspaceWindows.length === 0 && workspaceRegions.length === 0) {
    throw new Error('There is no canvas state to save as a workspace.');
  }

  const now = new Date().toISOString();
  const workspace: SavedWorkspace = {
    id: crypto.randomUUID(),
    name: input.name.trim() || `Workspace ${new Date().toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    windows: workspaceWindows,
    regions: workspaceRegions
  };

  const workspaces = await readWorkspaces();
  workspaces.unshift(workspace);
  await writeWorkspaces(workspaces);
  return workspace;
});

handleTrusted('workspaces:delete', async (_event, id: string): Promise<void> => {
  const workspaces = await readWorkspaces();
  await writeWorkspaces(workspaces.filter((workspace) => workspace.id !== id));
});

handleTrusted('workspaces:restore', async (_event, id: string): Promise<RestoreResult> => {
  const workspaces = await readWorkspaces();
  const workspace = workspaces.find((item) => item.id === id);
  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  return sendWindowControlCommand<RestoreResult>('restore', { windows: workspace.windows });
});

handleTrusted('templates:restore', async (_event, id: string): Promise<RestoreResult> => {
  const templates = await readTemplates();
  const template = templates.find((item) => item.id === id);
  if (!template) {
    throw new Error('Template not found.');
  }

  return sendWindowControlCommand<RestoreResult>('restore', { windows: template.windows });
});

handleTrusted('layout:apply', async (_event, input: ApplyLayoutInput): Promise<RestoreResult> => {
  const restorableWindows = input.windows.filter(isRestorableWindow);

  if (restorableWindows.length === 0) {
    throw new Error('No restorable windows to apply.');
  }

  return sendWindowControlCommand<RestoreResult>('restore', { windows: restorableWindows });
});

handleTrusted('window:focus', async (_event, hwnd: string): Promise<FocusWindowResult> => {
  if (isBlankHwnd(hwnd)) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  return sendWindowControlCommand<FocusWindowResult>('focus', { hwnd });
});

handleTrusted('window:work', async (event, hwnd: string): Promise<FocusWindowResult> => {
  if (isBlankHwnd(hwnd)) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  const firstFocusResult = await sendWindowControlCommand<FocusWindowResult>('focus', { hwnd });
  const controllerWindow = getControllerWindow(event);

  if (controllerWindow) {
    controllerWindow.minimize();
  }

  const secondFocusResult = await sendWindowControlCommand<FocusWindowResult>('focus', { hwnd });
  return {
    success: firstFocusResult.success || secondFocusResult.success,
    hwnd,
    error: firstFocusResult.success || secondFocusResult.success ? undefined : secondFocusResult.error || firstFocusResult.error
  };
});

handleTrusted('window:command', async (_event, hwnd: string, command: WindowCommand): Promise<WindowCommandResult> => {
  const allowedCommands = new Set<WindowCommand>(['focus', 'minimize', 'maximize', 'restore', 'close']);

  if (isBlankHwnd(hwnd)) {
    return {
      success: false,
      hwnd: '',
      command,
      error: 'No HWND was provided.'
    };
  }

  if (!allowedCommands.has(command)) {
    return {
      success: false,
      hwnd,
      command,
      error: 'Unsupported window command.'
    };
  }

  return sendWindowControlCommand<WindowCommandResult>('command', { hwnd, command });
});

handleTrusted('app:set-overlay-mode', async (event, enabled: boolean): Promise<OverlayModeResult> => {
  const controllerWindow = getControllerWindow(event);
  if (!controllerWindow) {
    return {
      success: false,
      enabled: false,
      error: 'InfiniteDesk controller window is not available.'
    };
  }

  try {
    if (enabled) {
      if (!overlayRestoreBounds) {
        overlayRestoreBounds = controllerWindow.getBounds();
      }

      const nearestDisplay = screen.getDisplayMatching(controllerWindow.getBounds());
      controllerWindow.setAlwaysOnTop(true, 'screen-saver');
      controllerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      controllerWindow.setBounds(nearestDisplay.workArea);
      controllerWindow.show();
      controllerWindow.focus();
      return { success: true, enabled: true };
    }

    controllerWindow.setAlwaysOnTop(false);
    controllerWindow.setVisibleOnAllWorkspaces(false);
    if (overlayRestoreBounds) {
      controllerWindow.setBounds(overlayRestoreBounds);
    }
    overlayRestoreBounds = null;
    controllerWindow.show();
    controllerWindow.focus();
    return { success: true, enabled: false };
  } catch (error) {
    return {
      success: false,
      enabled,
      error: (error as Error).message
    };
  }
});

handleTrusted('window:relay-pointer', async (event, input: RelayPointerInput): Promise<RelayPointerResult> => {
  const controllerWindow = getControllerWindow(event);
  if (!controllerWindow) {
    return { success: false, hwnd: input.hwnd || '', error: 'InfiniteDesk controller window is not available.' };
  }

  const validActions: RelayPointerInput['action'][] = ['down', 'move', 'up', 'cancel', 'wheel'];
  if (
    !input.hwnd ||
    !Number.isFinite(input.normalizedX) ||
    !Number.isFinite(input.normalizedY) ||
    !validActions.includes(input.action)
  ) {
    return { success: false, hwnd: input.hwnd || '', error: 'Invalid mirrored pointer input.' };
  }

  controllerWindow.setAlwaysOnTop(true, 'screen-saver');
  const result = sendDwmPreviewCommand({
    action: 'input',
    input: {
      hwnd: input.hwnd,
      normalizedX: Math.min(1, Math.max(0, input.normalizedX)),
      normalizedY: Math.min(1, Math.max(0, input.normalizedY)),
      phase: input.action,
      button: input.button || 'left',
      buttons: Math.max(0, Math.round(input.buttons || 0)),
      clickCount: Math.max(1, Math.min(2, Math.round(input.clickCount || 1))),
      wheelDelta: Math.round(input.wheelDelta || 0)
    }
  });
  if (result.success && input.action === 'up') {
    controllerWindow.webContents.send('windows:interaction-complete', input.hwnd);
  }
  return {
    success: result.success,
    hwnd: input.hwnd,
    error: result.error
  };
});

handleTrusted('app:quit', (): void => {
  app.quit();
});

handleTrusted('window:embed', async (event, params: EmbedWindowParams): Promise<EmbedResult> => {
  const controllerWindow = getControllerWindow(event);
  if (!controllerWindow) {
    return {
      success: false,
      hwnd: params.hwnd || '',
      error: 'InfiniteDesk controller window is not available.'
    };
  }

  if (isBlankHwnd(params.hwnd)) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  const hostHwnd = params.hostHwnd && params.hostHwnd.trim().length > 0
    ? params.hostHwnd
    : nativeWindowHandleToString(controllerWindow.getNativeWindowHandle());

  const result = await sendWindowControlCommand<EmbedResult>('embed', {
    hwnd: params.hwnd,
    hostHwnd,
    ...normalizeEmbedBounds(params)
  });

  if (
    result.success &&
    result.originalParentHwnd !== undefined &&
    result.originalStyle !== undefined &&
    result.originalExStyle !== undefined &&
    result.originalX !== undefined &&
    result.originalY !== undefined &&
    result.originalWidth !== undefined &&
    result.originalHeight !== undefined
  ) {
    recordEmbeddedWindow(params.hwnd, {
      originalParentHwnd: result.originalParentHwnd,
      originalStyle: result.originalStyle,
      originalExStyle: result.originalExStyle,
      originalX: result.originalX,
      originalY: result.originalY,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight
    });
  }

  return result;
});

handleTrusted('window:detach-embedded', async (_event, hwnd: string): Promise<EmbedResult> => {
  if (isBlankHwnd(hwnd)) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  return detachEmbeddedWindow(hwnd);
});

handleTrusted('window:move-embedded', async (_event, params: MoveEmbeddedWindowParams): Promise<EmbedResult> => {
  if (isBlankHwnd(params.hwnd)) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  if (!hasEmbeddedWindow(params.hwnd)) {
    return {
      success: false,
      hwnd: params.hwnd,
      error: 'Window is not currently embedded by InfiniteDesk.'
    };
  }

  return queueEmbeddedMove(params);
});

handleTrusted('dwm:sync-previews', (event, previews: DwmPreviewWindow[]): DwmPreviewResult => {
  const controllerWindow = getControllerWindow(event);
  if (!controllerWindow) {
    return {
      success: false,
      error: 'InfiniteDesk controller window is not available.'
    };
  }

  return recordDwmPreviewSync(controllerWindow, previews);
});

handleTrusted('dwm:clear-previews', (): DwmPreviewResult => {
  return sendDwmPreviewCommand({ action: 'clear' });
});

handleTrusted('dock:list-apps', async (): Promise<DockApp[]> => {
  return listLocalDockApps();
});

handleTrusted('dock:launch-app', async (_event, appId: string): Promise<LaunchResult> => {
  return launchDockApp(appId);
});

app.whenReady().then(() => {
  // Start the native preview host while the renderer is loading so the first
  // real-window preview does not pay the PowerShell/WinForms cold-start cost.
  sendDwmPreviewCommand({ action: 'hide' });
  createWindow();

  const refitWindows = (): void => {
    BrowserWindow.getAllWindows().forEach((window) => fitBrowserWindowToDisplay(window));
  };

  screen.on('display-metrics-changed', refitWindows);
  screen.on('display-added', refitWindows);
  screen.on('display-removed', refitWindows);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', (event) => {
  stopDwmPreviewHost();

  if (isQuittingAfterDetach) {
    return;
  }

  if (getEmbeddedWindowCount() === 0) {
    stopWindowControlHost();
    return;
  }

  event.preventDefault();
  isQuittingAfterDetach = true;
  void detachAllEmbeddedWindows().finally(() => {
    stopWindowControlHost();
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
