import { app, BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import { resyncDwmPreviewsFor, clearDwmPreviewsFor, sendDwmPreviewCommand } from './dwm-preview-client';
import { hardenWebContents } from './security';

const isDev = !app.isPackaged;

const MIN_WINDOW_WIDTH = 720;
const MIN_WINDOW_HEIGHT = 480;
// Chromium stops painting windows that it believes are fully covered by an
// opaque native window. A one-step Windows alpha reduction is visually
// imperceptible but keeps InfiniteDesk out of that occlusion path.
const WINDOWS_NON_OCCLUDING_OPACITY = 254 / 255;

function getResponsiveWindowBounds(display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())): Rectangle {
  return { ...display.workArea };
}

function getResponsiveMinimumSize(bounds: Pick<Rectangle, 'width' | 'height'>): { minWidth: number; minHeight: number } {
  return {
    minWidth: Math.min(MIN_WINDOW_WIDTH, bounds.width),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, bounds.height)
  };
}

export function fitBrowserWindowToDisplay(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isFullScreen() || window.isMaximized()) {
    return;
  }

  const bounds = window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const nextBounds: Rectangle = { ...display.workArea };

  const minimumSize = getResponsiveMinimumSize(nextBounds);
  window.setMinimumSize(minimumSize.minWidth, minimumSize.minHeight);

  if (
    nextBounds.x !== bounds.x ||
    nextBounds.y !== bounds.y ||
    nextBounds.width !== bounds.width ||
    nextBounds.height !== bounds.height
  ) {
    window.setBounds(nextBounds);
  }
}

export function createWindow(): void {
  const windowBounds = getResponsiveWindowBounds();
  const minimumSize = getResponsiveMinimumSize(windowBounds);
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icons', 'icon.ico')
    : join(process.cwd(), 'resources', 'icons', 'icon.ico');
  const mainWindow = new BrowserWindow({
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: minimumSize.minWidth,
    minHeight: minimumSize.minHeight,
    title: 'InfiniteDesk',
    icon: iconPath,
    backgroundColor: '#00000000',
    transparent: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.platform === 'win32') {
    mainWindow.setOpacity(WINDOWS_NON_OCCLUDING_OPACITY);
  }

  hardenWebContents(mainWindow.webContents);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer:did-fail-load] ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:gone] ${details.reason}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[renderer] did-finish-load');
  });

  mainWindow.on('move', () => resyncDwmPreviewsFor(mainWindow));
  mainWindow.on('resize', () => resyncDwmPreviewsFor(mainWindow));
  mainWindow.on('restore', () => resyncDwmPreviewsFor(mainWindow));
  mainWindow.on('show', () => resyncDwmPreviewsFor(mainWindow));
  mainWindow.on('minimize', () => {
    sendDwmPreviewCommand({ action: 'hide' });
  });
  mainWindow.on('hide', () => {
    sendDwmPreviewCommand({ action: 'hide' });
  });
  mainWindow.on('closed', () => {
    clearDwmPreviewsFor(mainWindow);
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}
