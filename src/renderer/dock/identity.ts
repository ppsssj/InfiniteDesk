import type { DockApp } from '../../shared/types';

export function getDockAppIdentityKey(app: DockApp): string {
  const argsKey = (app.args || []).join('\u0000').trim().toLowerCase();
  if (app.processName && argsKey.length === 0) {
    return `process:${app.processName.trim().toLowerCase()}`;
  }

  return `target:${app.executablePath.trim().toLowerCase()}|${argsKey}`;
}

export function compareDockAppsByName(left: DockApp, right: DockApp): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

export function uniqueDockApps(apps: DockApp[]): DockApp[] {
  const seen = new Set<string>();
  return apps.filter((app) => {
    const key = getDockAppIdentityKey(app);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
