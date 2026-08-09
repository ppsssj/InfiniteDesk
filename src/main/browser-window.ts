import { app, BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import { resyncDwmPreviewsFor, clearDwmPreviewsFor, sendDwmPreviewCommand } from './dwm-preview-client';

const isDev = !app.isPackaged;

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

export function fitBrowserWindowToDisplay(window: BrowserWindow): void {
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

export function createWindow(): void {
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
