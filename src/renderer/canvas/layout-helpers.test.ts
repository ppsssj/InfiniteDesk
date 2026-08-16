import { describe, expect, it } from 'vitest';
import {
  placeDetectedWindowsAtPoint,
  placeDetectedWindowsNearSource,
  placeVirtualWindowInRegion,
  processMatchesDockApp,
  regionToWorkspaceRegion,
  restoreResultText,
  virtualWindowToDetected,
  workspaceRegionToTemplateRegion
} from './layout-helpers';
import type { TemplateRegion, VirtualWindowState } from './types';
import type { DetectedWindow, DockApp, RestoreResult, WorkspaceRegion } from '../../shared/types';

function makeWindow(overrides: Partial<VirtualWindowState> = {}): VirtualWindowState {
  return {
    hwnd: '0x1',
    title: 'Window',
    processName: 'proc',
    realX: 0,
    realY: 0,
    virtualX: 10.4,
    virtualY: 20.6,
    width: 100.2,
    height: 50.9,
    ...overrides
  };
}

function makeRegion(overrides: Partial<TemplateRegion> = {}): TemplateRegion {
  return {
    id: 'region-1',
    name: 'Region',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    windowIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('virtualWindowToDetected', () => {
  it('rounds coordinates and marks helper windows with the "no preview" status', () => {
    const result = virtualWindowToDetected(makeWindow({ isHelper: true }));
    expect(result).toMatchObject({
      x: 10,
      y: 21,
      width: 100,
      height: 51,
      isIgnored: true,
      statusReason: 'No useful preview'
    });
  });

  it('marks non-helper windows as ready and defaults a missing hwnd to an empty string', () => {
    const result = virtualWindowToDetected(makeWindow({ hwnd: undefined, isHelper: false }));
    expect(result).toMatchObject({ hwnd: '', isIgnored: false, statusReason: 'Ready' });
  });
});

describe('restoreResultText', () => {
  it('formats a clean restore with no skipped windows', () => {
    const result: RestoreResult = { restored: 5, skipped: 0, errors: [] };
    expect(restoreResultText(result)).toBe('Restored 5 windows.');
  });

  it('appends skipped count and error messages when some windows were skipped', () => {
    const result: RestoreResult = { restored: 3, skipped: 2, errors: ['err1', 'err2'] };
    expect(restoreResultText(result)).toBe('Restored 3 windows. Skipped 2. err1 err2');
  });
});

describe('workspaceRegionToTemplateRegion / regionToWorkspaceRegion', () => {
  it('marks a workspace region as clean when loading it as a template region', () => {
    const workspaceRegion: WorkspaceRegion = {
      id: 'r1',
      name: 'R',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      windowIds: ['a'],
      createdAt: '2026-01-01T00:00:00.000Z'
    };
    expect(workspaceRegionToTemplateRegion(workspaceRegion)).toEqual({ ...workspaceRegion, isDirty: false });
  });

  it('rounds coordinates when converting back to a workspace region', () => {
    const region = makeRegion({ x: 1.4, y: 2.6, width: 3.5, height: 4.4 });
    expect(regionToWorkspaceRegion(region)).toMatchObject({ x: 1, y: 3, width: 4, height: 4 });
  });
});

describe('processMatchesDockApp', () => {
  function makeDockApp(overrides: Partial<DockApp> = {}): DockApp {
    return { id: 'code', name: 'VS Code', executablePath: 'C:\\code.exe', isPinned: false, ...overrides };
  }

  function makeDetectedWindow(processName: string): DetectedWindow {
    return {
      hwnd: '0x1',
      title: 'Window',
      processName,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      isMinimized: false,
      isRestorable: true
    };
  }

  it('matches on exact process name (case-insensitive)', () => {
    expect(processMatchesDockApp(makeDetectedWindow('Code'), makeDockApp({ processName: 'code' }))).toBe(true);
  });

  it('matches when the window process name contains the dock app process name', () => {
    expect(processMatchesDockApp(makeDetectedWindow('code-insiders'), makeDockApp({ processName: 'code' }))).toBe(true);
  });

  it('matches when the dock app process name contains the window process name', () => {
    expect(processMatchesDockApp(makeDetectedWindow('code'), makeDockApp({ processName: 'code-insiders' }))).toBe(true);
  });

  it('falls back to the dock app id when processName is not set', () => {
    expect(processMatchesDockApp(makeDetectedWindow('code'), makeDockApp({ processName: undefined, id: 'code' }))).toBe(true);
  });

  it('returns false when neither name relates to the other', () => {
    expect(processMatchesDockApp(makeDetectedWindow('notepad'), makeDockApp({ processName: 'code' }))).toBe(false);
  });
});

describe('placeVirtualWindowInRegion', () => {
  it('computes a deterministic grid offset from the index', () => {
    const region = makeRegion({ x: 100, y: 200 });
    const result = placeVirtualWindowInRegion(makeWindow(), region, 0);
    expect(result).toMatchObject({ virtualX: 136, virtualY: 272, initialVirtualX: 136, initialVirtualY: 272, isDirty: true });
  });

  it('wraps the offset every 4 indices', () => {
    const region = makeRegion({ x: 100, y: 200 });
    const atIndex1 = placeVirtualWindowInRegion(makeWindow(), region, 1);
    const atIndex5 = placeVirtualWindowInRegion(makeWindow(), region, 5);
    expect(atIndex5.virtualX).toBe(atIndex1.virtualX);
    expect(atIndex5.virtualY).toBe(atIndex1.virtualY);
  });
});

describe('placeDetectedWindowsNearSource', () => {
  it('places new windows relative to the source window when it is found', () => {
    const sourceWindow = makeWindow({ hwnd: 'src', virtualX: 100, virtualY: 100, width: 200, height: 100 });
    const result = placeDetectedWindowsNearSource([makeWindow({ hwnd: 'new' })], [sourceWindow], 'src');

    expect(result[0]).toMatchObject({
      virtualX: 100 + 200 + 80,
      virtualY: 100,
      initialVirtualX: 100 + 200 + 80,
      initialVirtualY: 100,
      isDirty: false
    });
  });

  it('falls back to a default origin when there is no source window and no existing windows', () => {
    const result = placeDetectedWindowsNearSource([makeWindow({ hwnd: 'new' })], [], 'missing');
    expect(result[0]).toMatchObject({ virtualX: 120, virtualY: 120, isDirty: false });
  });
});

describe('placeDetectedWindowsAtPoint', () => {
  it('places newly launched windows at the requested canvas point', () => {
    const result = placeDetectedWindowsAtPoint([makeWindow({ hwnd: '0x1' }), makeWindow({ hwnd: '0x2' })], {
      x: 420.4,
      y: 180.6
    });

    expect(result[0]).toMatchObject({ virtualX: 420, virtualY: 181, initialVirtualX: 420, initialVirtualY: 181, isDirty: false });
    expect(result[1]).toMatchObject({ virtualX: 492, virtualY: 253, initialVirtualX: 492, initialVirtualY: 253, isDirty: false });
  });
});
