import { app, BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import { basename, extname } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

const isDev = !app.isPackaged;
let overlayRestoreBounds: Rectangle | null = null;
const embeddedWindows = new Map<string, Required<Pick<EmbedResult, 'originalParentHwnd' | 'originalStyle' | 'originalExStyle' | 'originalX' | 'originalY' | 'originalWidth' | 'originalHeight'>>>();
const embeddedMoveQueue = new Map<string, { inFlight: boolean; latest: MoveEmbeddedWindowParams | null }>();
let dwmPreviewHost: ChildProcessWithoutNullStreams | null = null;
let dwmPreviewOwner: BrowserWindow | null = null;
let latestDwmPreviews: DwmPreviewWindow[] = [];
let isQuittingAfterDetach = false;

app.disableHardwareAcceleration();

const WINDOW_MARGIN = 16;
const MAX_INITIAL_WINDOW_WIDTH = 1440;
const MAX_INITIAL_WINDOW_HEIGHT = 920;
const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 480;
const APP_SCAN_MAX_DEPTH = 6;
const APP_SCAN_EXTENSIONS = new Set(['.lnk', '.url', '.exe']);

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

  const resyncDwmPreviews = (): void => {
    if (dwmPreviewOwner === mainWindow && latestDwmPreviews.length > 0) {
      syncDwmPreviewWindows(mainWindow, latestDwmPreviews);
    }
  };
  mainWindow.on('move', resyncDwmPreviews);
  mainWindow.on('resize', resyncDwmPreviews);
  mainWindow.on('restore', resyncDwmPreviews);
  mainWindow.on('show', resyncDwmPreviews);
  mainWindow.on('minimize', () => {
    sendDwmPreviewCommand({ action: 'hide' });
  });
  mainWindow.on('hide', () => {
    sendDwmPreviewCommand({ action: 'hide' });
  });
  mainWindow.on('closed', () => {
    if (dwmPreviewOwner === mainWindow) {
      dwmPreviewOwner = null;
      latestDwmPreviews = [];
      sendDwmPreviewCommand({ action: 'clear' });
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function getTemplatesStoragePath(): string {
  return join(app.getPath('userData'), 'templates.json');
}

function getWorkspacesStoragePath(): string {
  return join(app.getPath('userData'), 'workspaces.json');
}

async function ensureJsonStorage(path: string): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  if (!existsSync(path)) {
    await writeFile(path, '[]', 'utf8');
  }
}

async function readTemplates(): Promise<LayoutTemplate[]> {
  const storagePath = getTemplatesStoragePath();
  await ensureJsonStorage(storagePath);
  const raw = await readFile(storagePath, 'utf8');
  return JSON.parse(raw) as LayoutTemplate[];
}

async function writeTemplates(templates: LayoutTemplate[]): Promise<void> {
  const storagePath = getTemplatesStoragePath();
  await ensureJsonStorage(storagePath);
  await writeFile(storagePath, JSON.stringify(templates, null, 2), 'utf8');
}

async function readWorkspaces(): Promise<SavedWorkspace[]> {
  const storagePath = getWorkspacesStoragePath();
  await ensureJsonStorage(storagePath);
  const raw = await readFile(storagePath, 'utf8');
  return JSON.parse(raw) as SavedWorkspace[];
}

async function writeWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  const storagePath = getWorkspacesStoragePath();
  await ensureJsonStorage(storagePath);
  await writeFile(storagePath, JSON.stringify(workspaces, null, 2), 'utf8');
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

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const message = JSON.parse(line) as { event?: string; hwnd?: string };
        if (
          message.event === 'interaction' &&
          message.hwnd &&
          dwmPreviewOwner &&
          !dwmPreviewOwner.isDestroyed()
        ) {
          dwmPreviewOwner.webContents.send('windows:interaction-complete', message.hwnd);
        } else if (
          message.event === 'window-closed' &&
          message.hwnd &&
          dwmPreviewOwner &&
          !dwmPreviewOwner.isDestroyed()
        ) {
          dwmPreviewOwner.webContents.send('windows:closed', message.hwnd);
        }
      } catch {
        // Ignore non-protocol output from the native preview host.
      }
    }
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

function syncDwmPreviewWindows(controllerWindow: BrowserWindow, previews: DwmPreviewWindow[]): DwmPreviewResult {
  if (controllerWindow.isDestroyed() || controllerWindow.isMinimized() || !controllerWindow.isVisible()) {
    return sendDwmPreviewCommand({ action: 'hide' });
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
    ownerHwnd: nativeWindowHandleToString(controllerWindow.getNativeWindowHandle()),
    previews: adjustedPreviews
  });
}

function getDockAppId(path: string): string {
  return `local-${Buffer.from(path.toLowerCase()).toString('base64url').slice(0, 42)}`;
}

function getAppSearchRoots(): string[] {
  return [
    process.env.APPDATA ? join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs') : '',
    process.env.ProgramData ? join(process.env.ProgramData, 'Microsoft/Windows/Start Menu/Programs') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Desktop') : '',
    process.env.PUBLIC ? join(process.env.PUBLIC, 'Desktop') : ''
  ].filter((path) => path.length > 0 && existsSync(path));
}

function getDockAppName(path: string): string {
  return basename(path, extname(path)).replace(/\s+-\s+Shortcut$/i, '').trim();
}

async function getDockAppIconDataUrl(path: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(path, { size: 'normal' });
    if (icon.isEmpty()) {
      return undefined;
    }

    return icon.toDataURL();
  } catch {
    return undefined;
  }
}

async function collectDockAppsFromDirectory(root: string, depth = 0): Promise<DockApp[]> {
  if (depth > APP_SCAN_MAX_DEPTH) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const apps: DockApp[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      apps.push(...(await collectDockAppsFromDirectory(path, depth + 1)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    if (!APP_SCAN_EXTENSIONS.has(extension)) {
      continue;
    }

    const name = getDockAppName(path);
    if (name.length === 0 || name.toLowerCase().includes('uninstall')) {
      continue;
    }

    apps.push({
      id: getDockAppId(path),
      name,
      executablePath: path,
      icon: name.slice(0, 2).toUpperCase(),
      isPinned: false
    });
  }

  return apps;
}

async function listLocalDockApps(): Promise<DockApp[]> {
  const roots = getAppSearchRoots();
  const discovered = (await Promise.all(roots.map((root) => collectDockAppsFromDirectory(root).catch(() => [])))).flat();
  const seen = new Set<string>();

  const uniqueApps = discovered
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((dockApp) => {
      const key = `${dockApp.name.toLowerCase()}|${dockApp.executablePath.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  const appsWithIcons: DockApp[] = [];
  for (const dockApp of uniqueApps) {
    appsWithIcons.push({
      ...dockApp,
      iconDataUrl: await getDockAppIconDataUrl(dockApp.executablePath)
    });
  }

  return appsWithIcons;
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

ipcMain.handle('workspaces:list', async (): Promise<SavedWorkspace[]> => {
  return readWorkspaces();
});

ipcMain.handle('workspaces:create', async (_event, input: CreateWorkspaceInput): Promise<SavedWorkspace> => {
  const workspaceWindows = input.windows.filter(
    (windowInfo) =>
      windowInfo.isRestorable &&
      !windowInfo.isInternal &&
      windowInfo.x !== null &&
      windowInfo.y !== null &&
      windowInfo.width !== null &&
      windowInfo.height !== null
  );

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

ipcMain.handle('workspaces:delete', async (_event, id: string): Promise<void> => {
  const workspaces = await readWorkspaces();
  await writeWorkspaces(workspaces.filter((workspace) => workspace.id !== id));
});

ipcMain.handle('workspaces:restore', async (_event, id: string): Promise<RestoreResult> => {
  const workspaces = await readWorkspaces();
  const workspace = workspaces.find((item) => item.id === id);
  if (!workspace) {
    throw new Error('Workspace not found.');
  }

  const payloadPath = join(app.getPath('temp'), `infinitedesk-workspace-${workspace.id}.json`);
  await writeFile(payloadPath, JSON.stringify({ windows: workspace.windows }), 'utf8');
  return runWindowsScript<RestoreResult>(['-Action', 'restore', '-PayloadPath', payloadPath]);
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

ipcMain.handle('window:relay-pointer', async (event, input: RelayPointerInput): Promise<RelayPointerResult> => {
  const controllerWindow = BrowserWindow.fromWebContents(event.sender);
  if (!controllerWindow || controllerWindow.isDestroyed()) {
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

ipcMain.handle('app:quit', (): void => {
  app.quit();
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

  dwmPreviewOwner = controllerWindow;
  latestDwmPreviews = previews;
  return syncDwmPreviewWindows(controllerWindow, previews);
});

ipcMain.handle('dwm:clear-previews', (): DwmPreviewResult => {
  return sendDwmPreviewCommand({ action: 'clear' });
});

ipcMain.handle('dock:list-apps', async (): Promise<DockApp[]> => {
  return listLocalDockApps();
});

ipcMain.handle('dock:launch-app', async (_event, dockApp: DockApp): Promise<LaunchResult> => {
  if (!dockApp.executablePath || dockApp.executablePath.trim().length === 0) {
    return { success: false, error: 'No executable path was provided.' };
  }

  return new Promise((resolve) => {
    try {
      const extension = extname(dockApp.executablePath).toLowerCase();
      const child =
        extension === '.lnk' || extension === '.url'
          ? spawn(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Start-Process -FilePath $args[0]', dockApp.executablePath],
              {
                detached: true,
                windowsHide: true,
                stdio: 'ignore'
              }
            )
          : spawn(dockApp.executablePath, dockApp.args || [], {
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
