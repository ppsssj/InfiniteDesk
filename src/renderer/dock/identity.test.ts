import { describe, expect, it } from 'vitest';
import type { DockApp } from '../../shared/types';
import { compareDockAppsByName, getDockAppIdentityKey, uniqueDockApps } from './identity';

function makeApp(overrides: Partial<DockApp> = {}): DockApp {
  return {
    id: 'app',
    name: 'App',
    executablePath: 'C:\\App\\app.exe',
    processName: 'app',
    isPinned: false,
    ...overrides
  };
}

describe('getDockAppIdentityKey', () => {
  it('uses the process name for normal app windows', () => {
    expect(getDockAppIdentityKey(makeApp({ name: 'Google Chrome', executablePath: 'C:\\Shortcuts\\Chrome.lnk', processName: 'chrome' }))).toBe(
      'process:chrome'
    );
  });

  it('keeps argument-specific launcher entries distinct', () => {
    const recycleBin = makeApp({ executablePath: 'explorer.exe', processName: 'explorer', args: ['shell:RecycleBinFolder'] });

    expect(getDockAppIdentityKey(recycleBin)).toBe('target:explorer.exe|shell:recyclebinfolder');
  });
});

describe('uniqueDockApps', () => {
  it('keeps the first matching app when local scans duplicate a pinned default app', () => {
    const chrome = makeApp({ id: 'chrome', name: 'Chrome', executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', processName: 'chrome' });
    const googleChrome = makeApp({ id: 'local-chrome', name: 'Google Chrome', executablePath: 'C:\\Users\\me\\Start Menu\\Google Chrome.lnk', processName: 'chrome' });

    expect(uniqueDockApps([chrome, googleChrome]).map((app) => app.name)).toEqual(['Chrome']);
  });
});

describe('compareDockAppsByName', () => {
  it('sorts apps by display name', () => {
    const apps = [makeApp({ name: 'Settings' }), makeApp({ name: 'Chrome' })].sort(compareDockAppsByName);

    expect(apps.map((app) => app.name)).toEqual(['Chrome', 'Settings']);
  });
});
