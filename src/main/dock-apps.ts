import { app } from 'electron';
import { join, basename, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { DockApp, LaunchResult } from '../shared/types';

const APP_SCAN_MAX_DEPTH = 6;
const APP_SCAN_EXTENSIONS = new Set(['.lnk', '.url', '.exe']);

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

export async function listLocalDockApps(): Promise<DockApp[]> {
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

export function launchDockApp(dockApp: DockApp): Promise<LaunchResult> {
  if (!dockApp.executablePath || dockApp.executablePath.trim().length === 0) {
    return Promise.resolve({ success: false, error: 'No executable path was provided.' });
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
}
