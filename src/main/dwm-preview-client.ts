import { app, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { DwmPreviewResult, DwmPreviewWindow } from '../shared/types';
import { nativeWindowHandleToString } from './win32';

let dwmPreviewHost: ChildProcessWithoutNullStreams | null = null;
let dwmPreviewOwner: BrowserWindow | null = null;
let latestDwmPreviews: DwmPreviewWindow[] = [];

function getDwmPreviewHostPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'dwm-preview-host.ps1');
  }

  return join(process.cwd(), 'src/main/dwm-preview-host.ps1');
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

export function sendDwmPreviewCommand(command: unknown): DwmPreviewResult {
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

export function stopDwmPreviewHost(): void {
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

export function recordDwmPreviewSync(controllerWindow: BrowserWindow, previews: DwmPreviewWindow[]): DwmPreviewResult {
  dwmPreviewOwner = controllerWindow;
  latestDwmPreviews = previews;
  return syncDwmPreviewWindows(controllerWindow, previews);
}

export function resyncDwmPreviewsFor(window: BrowserWindow): void {
  if (dwmPreviewOwner === window && latestDwmPreviews.length > 0) {
    syncDwmPreviewWindows(window, latestDwmPreviews);
  }
}

export function clearDwmPreviewsFor(window: BrowserWindow): void {
  if (dwmPreviewOwner === window) {
    dwmPreviewOwner = null;
    latestDwmPreviews = [];
    sendDwmPreviewCommand({ action: 'clear' });
  }
}
