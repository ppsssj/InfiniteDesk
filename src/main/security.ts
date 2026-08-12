import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function getPackagedRendererUrl(): string {
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href;
}

export function isTrustedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const devServerUrl = process.env.ELECTRON_RENDERER_URL;

    if (devServerUrl) {
      return url.origin === new URL(devServerUrl).origin;
    }

    return url.href === getPackagedRendererUrl();
  } catch {
    return false;
  }
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame;
  if (!senderFrame || senderFrame !== event.sender.mainFrame || !isTrustedRendererUrl(senderFrame.url)) {
    throw new Error('Blocked IPC request from an untrusted renderer.');
  }
}

export function handleTrusted(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return listener(event, ...args);
  });
}

export function hardenWebContents(webContents: WebContents): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
    }
  });
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  webContents.session.setPermissionRequestHandler((_requestingWebContents, _permission, callback) => {
    callback(false);
  });
}
