import { app, BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type {
  ApplyLayoutInput,
  CreateTemplateInput,
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
  MoveWindowResult,
  OverlayModeResult,
  RestoreResult,
  WindowCommand,
  WindowCommandResult
} from '../shared/types';

const isDev = !app.isPackaged;
let overlayRestoreBounds: Rectangle | null = null;
const embeddedWindows = new Map<string, Required<Pick<EmbedResult, 'originalParentHwnd' | 'originalStyle' | 'originalExStyle' | 'originalX' | 'originalY' | 'originalWidth' | 'originalHeight'>>>();
const embeddedMoveQueue = new Map<string, { inFlight: boolean; latest: MoveEmbeddedWindowParams | null }>();
let dwmPreviewHost: ChildProcessWithoutNullStreams | null = null;
let isQuittingAfterDetach = false;

app.disableHardwareAcceleration();

const WINDOW_MARGIN = 16;
const MAX_INITIAL_WINDOW_WIDTH = 1440;
const MAX_INITIAL_WINDOW_HEIGHT = 920;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 480;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getResponsiveWindowBounds(display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())): Rectangle {
  const { workArea } = display;
  const marginX = workArea.width > WINDOW_MARGIN * 2 ? WINDOW_MARGIN : 0;
  const marginY = workArea.height > WINDOW_MARGIN * 2 ? WINDOW_MARGIN : 0;
  const availableWidth = Math.max(320, workArea.width - marginX * 2);
  const availableHeight = Math.max(280, workArea.height - marginY * 2);
  const width = Math.min(MAX_INITIAL_WINDOW_WIDTH, availableWidth);
  const height = Math.min(MAX_INITIAL_WINDOW_HEIGHT, availableHeight);

  return {
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height
  };
}

function getResponsiveMinimumSize(bounds: Pick<Rectangle, 'width' | 'height'>): { minWidth: number; minHeight: number } {
  return {
    minWidth: Math.min(MIN_WINDOW_WIDTH, bounds.width),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, bounds.height)
  };
}

function fitBrowserWindowToDisplay(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isFullScreen() || window.isMaximized()) {
    return;
  }

  const bounds = window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const { workArea } = display;
  const availableWidth = Math.max(320, workArea.width - WINDOW_MARGIN * 2);
  const availableHeight = Math.max(280, workArea.height - WINDOW_MARGIN * 2);
  const nextBounds: Rectangle = {
    x: bounds.x,
    y: bounds.y,
    width: Math.min(bounds.width, availableWidth),
    height: Math.min(bounds.height, availableHeight)
  };

  const minimumSize = getResponsiveMinimumSize(nextBounds);
  window.setMinimumSize(minimumSize.minWidth, minimumSize.minHeight);

  nextBounds.x = clampNumber(nextBounds.x, workArea.x, workArea.x + workArea.width - nextBounds.width);
  nextBounds.y = clampNumber(nextBounds.y, workArea.y, workArea.y + workArea.height - nextBounds.height);

  if (
    nextBounds.x !== bounds.x ||
    nextBounds.y !== bounds.y ||
    nextBounds.width !== bounds.width ||
    nextBounds.height !== bounds.height
  ) {
    window.setBounds(nextBounds);
  }
}

function createWindow(): void {
  const windowBounds = getResponsiveWindowBounds();
  const minimumSize = getResponsiveMinimumSize(windowBounds);
  const mainWindow = new BrowserWindow({
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: minimumSize.minWidth,
    minHeight: minimumSize.minHeight,
    title: 'InfiniteDesk',
    backgroundColor: '#00000000',
    transparent: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer:did-fail-load] ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:gone] ${details.reason}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[renderer] did-finish-load');
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function getStoragePath(): string {
  return join(app.getPath('userData'), 'templates.json');
}

async function ensureStorage(): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  const storagePath = getStoragePath();
  if (!existsSync(storagePath)) {
    await writeFile(storagePath, '[]', 'utf8');
  }
}

async function readTemplates(): Promise<LayoutTemplate[]> {
  await ensureStorage();
  const raw = await readFile(getStoragePath(), 'utf8');
  return JSON.parse(raw) as LayoutTemplate[];
}

async function writeTemplates(templates: LayoutTemplate[]): Promise<void> {
  await ensureStorage();
  await writeFile(getStoragePath(), JSON.stringify(templates, null, 2), 'utf8');
}

function getScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'windows.ps1');
  }

  return join(process.cwd(), 'src/main/windows.ps1');
}

function getDwmPreviewHostPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'dwm-preview-host.ps1');
  }

  return join(process.cwd(), 'src/main/dwm-preview-host.ps1');
}

function nativeWindowHandleToString(handle: Buffer): string {
  if (handle.length >= 8) {
    return `0x${handle.readBigUInt64LE(0).toString(16).toUpperCase()}`;
  }

  return `0x${handle.readUInt32LE(0).toString(16).toUpperCase()}`;
}

function runWindowsScript<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', getScriptPath(), ...args], {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Windows script exited with code ${code}`));
        return;
      }

      try {
        const trimmed = stdout.trim();
        resolve((trimmed ? JSON.parse(trimmed) : null) as T);
      } catch (error) {
        reject(new Error(`Could not parse Windows script output: ${(error as Error).message}`));
      }
    });
  });
}

function ensureDwmPreviewHost(): ChildProcessWithoutNullStreams {
  if (dwmPreviewHost && !dwmPreviewHost.killed && dwmPreviewHost.stdin.writable) {
    return dwmPreviewHost;
  }

  const hostPath = getDwmPreviewHostPath();
  if (!existsSync(hostPath)) {
    throw new Error(`DWM preview host was not found: ${hostPath}`);
  }

  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hostPath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  child.stdout.on('data', () => {
    // The preview host is command-driven; stdout is intentionally ignored.
  });

  child.stderr.on('data', (chunk: Buffer) => {
    console.error(`[dwm-preview] ${chunk.toString('utf8').trim()}`);
  });

  child.on('exit', () => {
    if (dwmPreviewHost === child) {
      dwmPreviewHost = null;
    }
  });

  dwmPreviewHost = child;
  return child;
}

function sendDwmPreviewCommand(command: unknown): DwmPreviewResult {
  try {
    const child = ensureDwmPreviewHost();
    child.stdin.write(`${JSON.stringify(command)}\n`, 'utf8');
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message
    };
  }
}

function stopDwmPreviewHost(): void {
  const child = dwmPreviewHost;
  dwmPreviewHost = null;
  if (!child || child.killed) {
    return;
  }

  try {
    if (child.stdin.writable) {
      child.stdin.write(`${JSON.stringify({ action: 'exit' })}\n`, 'utf8');
      child.stdin.end();
    }
  } catch {
    child.kill();
  }
}

function normalizeEmbedBounds(params: Pick<EmbedWindowParams, 'x' | 'y' | 'width' | 'height'>): string[] {
  return [
    '-X',
    String(Math.round(params.x)),
    '-Y',
    String(Math.round(params.y)),
    '-Width',
    String(Math.max(80, Math.round(params.width))),
    '-Height',
    String(Math.max(60, Math.round(params.height)))
  ];
}

function runEmbeddedMove(params: MoveEmbeddedWindowParams): Promise<EmbedResult> {
  return runWindowsScript<EmbedResult>([
    '-Action',
    'moveEmbedded',
    '-Hwnd',
    params.hwnd,
    ...normalizeEmbedBounds(params)
  ]);
}

async function drainEmbeddedMoveQueue(hwnd: string, firstMove: MoveEmbeddedWindowParams): Promise<void> {
  let currentMove: MoveEmbeddedWindowParams | null = firstMove;

  while (currentMove) {
    try {
      await runEmbeddedMove(currentMove);
    } catch (error) {
      console.error(`[embed:move] ${hwnd}: ${(error as Error).message}`);
    }

    const state = embeddedMoveQueue.get(hwnd);
    currentMove = state?.latest || null;
    if (state) {
      state.latest = null;
    }
  }

  embeddedMoveQueue.delete(hwnd);
}

function queueEmbeddedMove(params: MoveEmbeddedWindowParams): EmbedResult {
  const existing = embeddedMoveQueue.get(params.hwnd);

  if (existing?.inFlight) {
    existing.latest = params;
    return {
      success: true,
      hwnd: params.hwnd
    };
  }

  embeddedMoveQueue.set(params.hwnd, {
    inFlight: true,
    latest: null
  });

  void drainEmbeddedMoveQueue(params.hwnd, params);

  return {
    success: true,
    hwnd: params.hwnd
  };
}

async function detachEmbeddedWindow(hwnd: string): Promise<EmbedResult> {
  const original = embeddedWindows.get(hwnd);
  if (!original) {
    return {
      success: false,
      hwnd,
      error: 'Window is not currently embedded by InfiniteDesk.'
    };
  }

  const result = await runWindowsScript<EmbedResult>([
    '-Action',
    'detach',
    '-Hwnd',
    hwnd,
    '-OriginalParentHwnd',
    original.originalParentHwnd,
    '-OriginalStyle',
    original.originalStyle,
    '-OriginalExStyle',
    original.originalExStyle,
    '-OriginalX',
    String(original.originalX),
    '-OriginalY',
    String(original.originalY),
    '-OriginalWidth',
    String(original.originalWidth),
    '-OriginalHeight',
    String(original.originalHeight)
  ]);

  if (result.success) {
    embeddedWindows.delete(hwnd);
    embeddedMoveQueue.delete(hwnd);
  }

  return result;
}

async function detachAllEmbeddedWindows(): Promise<void> {
  const hwnds = Array.from(embeddedWindows.keys());
  for (const hwnd of hwnds) {
    try {
      await detachEmbeddedWindow(hwnd);
    } catch (error) {
      console.error(`[embed:detach-all] ${hwnd}: ${(error as Error).message}`);
    }
  }
}

ipcMain.handle('windows:scan', async (): Promise<DetectedWindow[]> => {
  const result = await runWindowsScript<DetectedWindow[] | DetectedWindow>(['-Action', 'scan']);
  return Array.isArray(result) ? result : [result];
});

ipcMain.handle('templates:list', async (): Promise<LayoutTemplate[]> => {
  return readTemplates();
});

ipcMain.handle('templates:create', async (_event, input: CreateTemplateInput): Promise<LayoutTemplate> => {
  const restorableWindows = input.windows.filter(
    (windowInfo) =>
      windowInfo.isRestorable &&
      !windowInfo.isInternal &&
      windowInfo.x !== null &&
      windowInfo.y !== null &&
      windowInfo.width !== null &&
      windowInfo.height !== null
  );

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

ipcMain.handle('templates:delete', async (_event, id: string): Promise<void> => {
  const templates = await readTemplates();
  await writeTemplates(templates.filter((template) => template.id !== id));
});

ipcMain.handle('templates:restore', async (_event, id: string): Promise<RestoreResult> => {
  const templates = await readTemplates();
  const template = templates.find((item) => item.id === id);
  if (!template) {
    throw new Error('Template not found.');
  }

  const payloadPath = join(app.getPath('temp'), `infinitedesk-restore-${template.id}.json`);
  await writeFile(payloadPath, JSON.stringify({ windows: template.windows }), 'utf8');
  return runWindowsScript<RestoreResult>(['-Action', 'restore', '-PayloadPath', payloadPath]);
});

ipcMain.handle('layout:apply', async (_event, input: ApplyLayoutInput): Promise<RestoreResult> => {
  const restorableWindows = input.windows.filter(
    (windowInfo) =>
      windowInfo.isRestorable &&
      !windowInfo.isInternal &&
      windowInfo.x !== null &&
      windowInfo.y !== null &&
      windowInfo.width !== null &&
      windowInfo.height !== null
  );

  if (restorableWindows.length === 0) {
    throw new Error('No restorable windows to apply.');
  }

  const payloadPath = join(app.getPath('temp'), `infinitedesk-apply-${crypto.randomUUID()}.json`);
  await writeFile(payloadPath, JSON.stringify({ windows: restorableWindows }), 'utf8');
  return runWindowsScript<RestoreResult>(['-Action', 'restore', '-PayloadPath', payloadPath]);
});

ipcMain.handle('window:move', async (_event, windowInfo: DetectedWindow): Promise<MoveWindowResult> => {
  if (
    !windowInfo.hwnd ||
    windowInfo.isInternal ||
    !windowInfo.isRestorable ||
    windowInfo.x === null ||
    windowInfo.y === null ||
    windowInfo.width === null ||
    windowInfo.height === null
  ) {
    return {
      success: false,
      hwnd: windowInfo.hwnd || '',
      error: 'Window is not a restorable external target.'
    };
  }

  return runWindowsScript<MoveWindowResult>([
    '-Action',
    'move',
    '-Hwnd',
    windowInfo.hwnd,
    '-X',
    String(Math.round(windowInfo.x)),
    '-Y',
    String(Math.round(windowInfo.y)),
    '-Width',
    String(Math.round(windowInfo.width)),
    '-Height',
    String(Math.round(windowInfo.height))
  ]);
});

ipcMain.handle('window:focus', async (_event, hwnd: string): Promise<FocusWindowResult> => {
  if (!hwnd || hwnd.trim().length === 0) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  return runWindowsScript<FocusWindowResult>(['-Action', 'focus', '-Hwnd', hwnd]);
});

ipcMain.handle('window:work', async (event, hwnd: string): Promise<FocusWindowResult> => {
  if (!hwnd || hwnd.trim().length === 0) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  const firstFocusResult = await runWindowsScript<FocusWindowResult>(['-Action', 'focus', '-Hwnd', hwnd]);
  const controllerWindow = BrowserWindow.fromWebContents(event.sender);

  if (controllerWindow && !controllerWindow.isDestroyed()) {
    controllerWindow.minimize();
  }

  const secondFocusResult = await runWindowsScript<FocusWindowResult>(['-Action', 'focus', '-Hwnd', hwnd]);
  return {
    success: firstFocusResult.success || secondFocusResult.success,
    hwnd,
    error: firstFocusResult.success || secondFocusResult.success ? undefined : secondFocusResult.error || firstFocusResult.error
  };
});

ipcMain.handle('window:command', async (_event, hwnd: string, command: WindowCommand): Promise<WindowCommandResult> => {
  const allowedCommands = new Set<WindowCommand>(['focus', 'minimize', 'maximize', 'restore', 'close']);

  if (!hwnd || hwnd.trim().length === 0) {
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

  return runWindowsScript<WindowCommandResult>(['-Action', 'command', '-Hwnd', hwnd, '-WindowCommand', command]);
});

ipcMain.handle('app:set-overlay-mode', async (event, enabled: boolean): Promise<OverlayModeResult> => {
  const controllerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!controllerWindow || controllerWindow.isDestroyed()) {
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

ipcMain.handle('window:embed', async (event, params: EmbedWindowParams): Promise<EmbedResult> => {
  const controllerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!controllerWindow || controllerWindow.isDestroyed()) {
    return {
      success: false,
      hwnd: params.hwnd || '',
      error: 'InfiniteDesk controller window is not available.'
    };
  }

  if (!params.hwnd || params.hwnd.trim().length === 0) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  const hostHwnd = params.hostHwnd && params.hostHwnd.trim().length > 0
    ? params.hostHwnd
    : nativeWindowHandleToString(controllerWindow.getNativeWindowHandle());

  const result = await runWindowsScript<EmbedResult>([
    '-Action',
    'embed',
    '-Hwnd',
    params.hwnd,
    '-HostHwnd',
    hostHwnd,
    ...normalizeEmbedBounds(params)
  ]);

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
    embeddedWindows.set(params.hwnd, {
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

ipcMain.handle('window:detach-embedded', async (_event, hwnd: string): Promise<EmbedResult> => {
  if (!hwnd || hwnd.trim().length === 0) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  return detachEmbeddedWindow(hwnd);
});

ipcMain.handle('window:move-embedded', async (_event, params: MoveEmbeddedWindowParams): Promise<EmbedResult> => {
  if (!params.hwnd || params.hwnd.trim().length === 0) {
    return {
      success: false,
      hwnd: '',
      error: 'No HWND was provided.'
    };
  }

  if (!embeddedWindows.has(params.hwnd)) {
    return {
      success: false,
      hwnd: params.hwnd,
      error: 'Window is not currently embedded by InfiniteDesk.'
    };
  }

  return queueEmbeddedMove(params);
});

ipcMain.handle('dwm:sync-previews', (event, previews: DwmPreviewWindow[]): DwmPreviewResult => {
  const controllerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!controllerWindow || controllerWindow.isDestroyed()) {
    return {
      success: false,
      error: 'InfiniteDesk controller window is not available.'
    };
  }

  const contentBounds = controllerWindow.getContentBounds();
  const adjustedPreviews = previews
    .filter((preview) => preview.id && preview.hwnd)
    .map((preview) => ({
      ...preview,
      x: Math.round(contentBounds.x + preview.x),
      y: Math.round(contentBounds.y + preview.y),
      width: Math.max(1, Math.round(preview.width)),
      height: Math.max(1, Math.round(preview.height)),
      opacity: preview.opacity ?? 255
    }));

  return sendDwmPreviewCommand({
    action: 'sync',
    previews: adjustedPreviews
  });
});

ipcMain.handle('dwm:clear-previews', (): DwmPreviewResult => {
  return sendDwmPreviewCommand({ action: 'clear' });
});

ipcMain.handle('dock:launch-app', async (_event, dockApp: DockApp): Promise<LaunchResult> => {
  if (!dockApp.executablePath || dockApp.executablePath.trim().length === 0) {
    return { success: false, error: 'No executable path was provided.' };
  }

  return new Promise((resolve) => {
    try {
      const child = spawn(dockApp.executablePath, dockApp.args || [], {
        detached: true,
        shell: false,
        windowsHide: false,
        stdio: 'ignore'
      });

      child.once('error', (error) => {
        resolve({
          success: false,
          error: error.message || `${dockApp.name} could not be launched.`
        });
      });

      child.once('spawn', () => {
        child.unref();
        resolve({ success: true });
      });
    } catch (error) {
      resolve({
        success: false,
        error: (error as Error).message || `${dockApp.name} could not be launched.`
      });
    }
  });
});

app.whenReady().then(() => {
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

  if (isQuittingAfterDetach || embeddedWindows.size === 0) {
    return;
  }

  event.preventDefault();
  isQuittingAfterDetach = true;
  void detachAllEmbeddedWindows().finally(() => {
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
