import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type {
  ApplyLayoutInput,
  CreateTemplateInput,
  DetectedWindow,
  DockApp,
  FocusWindowResult,
  LaunchResult,
  LayoutTemplate,
  MoveWindowResult,
  RestoreResult,
  WindowCommand,
  WindowCommandResult
} from '../shared/types';

const isDev = !app.isPackaged;

app.disableHardwareAcceleration();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'InfiniteDesk',
    backgroundColor: '#050506',
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
