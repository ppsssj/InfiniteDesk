import { describe, expect, it } from 'vitest';
import { createRegionFromTemplate, getWindowIdentity, getWindowsForRegion, isWindowInsideRegion, updateRegionMembership } from './regions';
import type { TemplateRegion, VirtualWindowState } from './types';
import type { LayoutTemplate } from '../../shared/types';

function makeWindow(overrides: Partial<VirtualWindowState> = {}): VirtualWindowState {
  return {
    hwnd: undefined,
    title: 'Window',
    processName: 'proc',
    realX: 0,
    realY: 0,
    virtualX: 0,
    virtualY: 0,
    width: 100,
    height: 100,
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

describe('getWindowIdentity', () => {
  it('uses the hwnd when present', () => {
    expect(getWindowIdentity(makeWindow({ hwnd: '0x1' }))).toBe('0x1');
  });

  it('falls back to processName:title when hwnd is absent', () => {
    expect(getWindowIdentity(makeWindow({ processName: 'code', title: 'main.tsx' }))).toBe('code:main.tsx');
  });
});

describe('isWindowInsideRegion', () => {
  const region = makeRegion({ x: 0, y: 0, width: 100, height: 100 });

  it('returns true when the window center is inside the region', () => {
    const windowInfo = makeWindow({ virtualX: 0, virtualY: 0, width: 50, height: 50 });
    expect(isWindowInsideRegion(windowInfo, region)).toBe(true);
  });

  it('returns false when the window center is outside the region', () => {
    const windowInfo = makeWindow({ virtualX: 500, virtualY: 500, width: 50, height: 50 });
    expect(isWindowInsideRegion(windowInfo, region)).toBe(false);
  });

  it('treats the region edge as inclusive', () => {
    const windowInfo = makeWindow({ virtualX: 80, virtualY: 80, width: 40, height: 40 });
    // center = (100, 100), exactly on the region's bottom-right corner
    expect(isWindowInsideRegion(windowInfo, region)).toBe(true);
  });
});

describe('updateRegionMembership', () => {
  it('excludes windows that fall outside every region', () => {
    const regions = [makeRegion({ id: 'a', x: 0, y: 0, width: 100, height: 100 })];
    const windowInfo = makeWindow({ hwnd: '0x1', virtualX: 500, virtualY: 500 });

    const result = updateRegionMembership([windowInfo], regions);
    expect(result[0].windowIds).toEqual([]);
  });

  it('assigns a window to the last region that contains it when regions overlap', () => {
    const regionA = makeRegion({ id: 'a', x: 0, y: 0, width: 100, height: 100 });
    const regionB = makeRegion({ id: 'b', x: 50, y: 0, width: 100, height: 100 });
    const windowInfo = makeWindow({ hwnd: '0x1', virtualX: 25, virtualY: 0, width: 100, height: 100 });
    // center = (75, 50): inside both regionA (0-100) and regionB (50-150)

    const result = updateRegionMembership([windowInfo], [regionA, regionB]);
    expect(result.find((region) => region.id === 'a')?.windowIds).toEqual([]);
    expect(result.find((region) => region.id === 'b')?.windowIds).toEqual(['0x1']);
  });
});

describe('getWindowsForRegion', () => {
  it('filters windows by identity membership in region.windowIds', () => {
    const windowA = makeWindow({ hwnd: '0x1' });
    const windowB = makeWindow({ hwnd: '0x2' });
    const region = makeRegion({ windowIds: ['0x1'] });

    expect(getWindowsForRegion([windowA, windowB], region)).toEqual([windowA]);
  });
});

describe('createRegionFromTemplate', () => {
  it('returns a null region when the template has no usable windows', () => {
    const template: LayoutTemplate = {
      id: 'template-1',
      name: 'Empty',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      windows: []
    };

    expect(createRegionFromTemplate(template)).toEqual({ region: null, windows: [] });
  });

  it('builds a padded bounding region around the template windows', () => {
    const template: LayoutTemplate = {
      id: 'template-1',
      name: 'My Template',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      windows: [
        {
          hwnd: '0x1',
          title: 'A',
          processName: 'a',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          isMinimized: false,
          isRestorable: true
        },
        {
          hwnd: '0x2',
          title: 'B',
          processName: 'b',
          x: 200,
          y: 150,
          width: 50,
          height: 50,
          isMinimized: false,
          isRestorable: true
        }
      ]
    };

    const { region, windows } = createRegionFromTemplate(template);
    expect(windows).toHaveLength(2);
    expect(region).toMatchObject({
      id: 'template-1',
      name: 'My Template',
      x: 0 - 80,
      y: 0 - 80,
      width: 250 + 160,
      height: 200 + 160,
      isDirty: false
    });
    expect(region?.windowIds).toEqual(['0x1', '0x2']);
  });
});
