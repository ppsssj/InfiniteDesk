import { app, shell } from 'electron';
import { join, basename, extname, isAbsolute, parse } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { DockApp, LaunchResult } from '../shared/types';

const APP_SCAN_MAX_DEPTH = 6;
const APP_SCAN_EXTENSIONS = new Set(['.lnk', '.url', '.exe']);
const ICON_WORKER_COUNT = 8;

const DEFAULT_DOCK_APPS: DockApp[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    executablePath: 'code',
    processName: 'Code',
    icon: 'VS',
    isPinned: true
  },
  {
    id: 'chrome',
    name: 'Chrome',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    processName: 'chrome',
    icon: 'CH',
    isPinned: true
  },
  {
    id: 'terminal',
    name: 'Terminal',
    executablePath: 'wt',
    processName: 'WindowsTerminal',
    icon: 'WT',
    isPinned: true
  },
  {
    id: 'explorer',
    name: 'Explorer',
    executablePath: 'explorer.exe',
    processName: 'explorer',
    icon: 'EX',
    isPinned: true
  }
];

const launchableDockApps = new Map(DEFAULT_DOCK_APPS.map((dockApp) => [dockApp.id, dockApp]));

type DiscoveredDockApp = DockApp & {
  iconSourcePaths: string[];
  identityKey: string;
};

function getDockAppId(path: string): string {
  const digest = createHash('sha256').update(path.toLowerCase()).digest('base64url').slice(0, 24);
  return `local-${digest}`;
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

function expandEnvironmentVariables(path: string): string {
  return path.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] || process.env[name.toUpperCase()] || _match);
}

function getSystemDockApps(): DiscoveredDockApp[] {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const driveRoot = parse(systemRoot).root;
  const explorerPath = join(systemRoot, 'explorer.exe');
  const settingsPath = join(systemRoot, 'ImmersiveControlPanel', 'SystemSettings.exe');
  const recycleBinPath = join(driveRoot, '$Recycle.Bin');

  return [
    {
      id: 'system-file-explorer',
      name: 'File Explorer',
      executablePath: explorerPath,
      processName: 'explorer',
      icon: 'FE',
      iconSourcePaths: [explorerPath],
      identityKey: `${explorerPath}|`.toLowerCase(),
      isPinned: false
    },
    {
      id: 'system-settings',
      name: 'Settings',
      executablePath: 'ms-settings:',
      processName: 'SystemSettings',
      icon: 'SE',
      iconSourcePaths: [settingsPath],
      identityKey: 'ms-settings:',
      isPinned: false
    },
    {
      id: 'system-recycle-bin',
      name: 'Recycle Bin',
      executablePath: explorerPath,
      args: ['shell:RecycleBinFolder'],
      processName: 'explorer',
      icon: 'RB',
      iconSourcePaths: [recycleBinPath, explorerPath],
      identityKey: `${explorerPath}|shell:RecycleBinFolder`.toLowerCase(),
      isPinned: false
    }
  ];
}

function cleanIconPath(path: string | undefined): string {
  return expandEnvironmentVariables((path || '').trim().replace(/^"|"$/g, ''));
}

function getShortcutDetails(path: string): Electron.ShortcutDetails | null {
  try {
    return shell.readShortcutLink(path);
  } catch {
    return null;
  }
}

async function getUrlShortcutIconPath(path: string): Promise<string> {
  const content = await readFile(path, 'utf8').catch(() => '');
  const match = content.match(/^IconFile=(.+)$/im);
  return cleanIconPath(match?.[1]);
}

async function getDockAppMetadata(path: string): Promise<Pick<DiscoveredDockApp, 'iconSourcePaths' | 'identityKey' | 'processName'>> {
  const extension = extname(path).toLowerCase();
  if (extension === '.lnk') {
    const details = getShortcutDetails(path);
    const target = cleanIconPath(details?.target);
    const icon = cleanIconPath(details?.icon);
    const processName = target ? basename(target, extname(target)) : undefined;
    return {
      iconSourcePaths: [icon, target, path].filter((candidate, index, candidates) => candidate && candidates.indexOf(candidate) === index),
      identityKey: `${target || path}|${details?.args || ''}`.toLowerCase(),
      processName
    };
  }

  if (extension === '.url') {
    const icon = await getUrlShortcutIconPath(path);
    return {
      iconSourcePaths: [icon, path].filter(Boolean),
      identityKey: path.toLowerCase(),
      processName: undefined
    };
  }

  return {
    iconSourcePaths: [path],
    identityKey: path.toLowerCase(),
    processName: basename(path, extension)
  };
}

async function getDockAppIconDataUrl(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (!path || !existsSync(path)) {
      continue;
    }

    try {
      const icon = await app.getFileIcon(path, { size: 'large' });
      if (!icon.isEmpty()) {
        return icon.toDataURL();
      }
    } catch {
      // Try the next icon source, ending with the shortcut itself.
    }
  }

  return undefined;
}

async function collectDockAppsFromDirectory(root: string, depth = 0): Promise<DiscoveredDockApp[]> {
  if (depth > APP_SCAN_MAX_DEPTH) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const apps: DiscoveredDockApp[] = [];

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

    const metadata = await getDockAppMetadata(path);

    apps.push({
      id: getDockAppId(path),
      name,
      executablePath: path,
      icon: name.slice(0, 2).toUpperCase(),
      processName: metadata.processName,
      iconSourcePaths: metadata.iconSourcePaths,
      identityKey: metadata.identityKey,
      isPinned: false
    });
  }

  return apps;
}

export async function listLocalDockApps(): Promise<DockApp[]> {
  const roots = getAppSearchRoots();
  const discovered = [
    ...getSystemDockApps(),
    ...(await Promise.all(roots.map((root) => collectDockAppsFromDirectory(root).catch(() => [])))).flat()
  ];
  const seen = new Set<string>();

  const uniqueApps = discovered
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((dockApp) => {
      const key = dockApp.identityKey;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  const appsWithIcons = new Array<DockApp>(uniqueApps.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(ICON_WORKER_COUNT, uniqueApps.length) }, async () => {
    while (nextIndex < uniqueApps.length) {
      const index = nextIndex++;
      const dockApp = uniqueApps[index];
      const iconDataUrl = await getDockAppIconDataUrl(dockApp.iconSourcePaths);
      const { iconSourcePaths: _iconSourcePaths, identityKey: _identityKey, ...publicDockApp } = dockApp;
      appsWithIcons[index] = {
        ...publicDockApp,
        iconDataUrl
      };
    }
  });
  await Promise.all(workers);

  for (const dockApp of appsWithIcons) {
    launchableDockApps.set(dockApp.id, dockApp);
  }

  return appsWithIcons;
}

export function registerLaunchableDockApps(apps: DockApp[]): void {
  for (const dockApp of apps) {
    launchableDockApps.set(dockApp.id, dockApp);
  }
}

export async function launchDockApp(appId: string): Promise<LaunchResult> {
  const dockApp = launchableDockApps.get(appId);
  if (!dockApp) {
    return { success: false, error: 'The requested app is not in the trusted Dock app list.' };
  }

  if (!dockApp.executablePath || dockApp.executablePath.trim().length === 0) {
    return { success: false, error: 'No executable path was provided.' };
  }

  try {
    const executablePath = dockApp.executablePath.trim();
    const extension = extname(executablePath).toLowerCase();
    if (/^[a-z][a-z0-9+.-]*:/i.test(executablePath) && !isAbsolute(executablePath)) {
      if (!executablePath.toLowerCase().startsWith('ms-settings:')) {
        return { success: false, error: 'Unsupported app URI scheme.' };
      }
      await shell.openExternal(executablePath);
      return { success: true };
    }

    const shouldUseWindowsShell = extension === '.lnk' || extension === '.url' || (isAbsolute(executablePath) && (dockApp.args?.length || 0) === 0);
    if (shouldUseWindowsShell) {
      const error = await shell.openPath(executablePath);
      return error ? { success: false, error } : { success: true };
    }

    return await new Promise((resolve) => {
      const child = spawn(executablePath, dockApp.args || [], {
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
    });
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message || `${dockApp.name} could not be launched.`
    };
  }
}
