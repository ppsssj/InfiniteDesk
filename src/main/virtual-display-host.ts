import { app, screen } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

let launchAttempted = false;

function hasVirtualDisplay(): boolean {
  const displays = screen.getAllDisplays();
  if (displays.some((display) => display.label.toLowerCase().includes('infinitedesk'))) {
    return true;
  }

  // Development machines may still have the original sample EDID installed.
  return !app.isPackaged && displays.length >= 3;
}

function getHostPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'InfiniteDeskVirtualDisplayHost.exe');
  }
  const releasePath = join(
    process.cwd(),
    'native',
    'virtual-display',
    'x64',
    'Release',
    'InfiniteDeskVirtualDisplayHost.exe'
  );
  if (existsSync(releasePath)) {
    return releasePath;
  }
  return join(process.cwd(), 'native', 'virtual-display', 'x64', 'Debug', 'InfiniteDeskVirtualDisplayHost.exe');
}

export function ensureVirtualDisplayHost(): void {
  if (launchAttempted || hasVirtualDisplay()) {
    return;
  }
  launchAttempted = true;

  const executablePath = getHostPath();
  if (!existsSync(executablePath)) {
    console.error(`[virtual-display-host] Host executable was not found: ${executablePath}`);
    return;
  }

  try {
    const child = spawn(executablePath, [], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', (error) => {
      console.error(`[virtual-display-host] Could not start: ${error.message}`);
    });
    child.unref();
  } catch (error) {
    console.error(`[virtual-display-host] Could not start: ${(error as Error).message}`);
  }
}
