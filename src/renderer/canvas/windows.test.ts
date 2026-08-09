import { describe, expect, it } from 'vitest';
import { createInitialVirtualLayout, getVirtualWindowBounds, hasUsableWindowBounds, toVirtualWindow, toVirtualWindows } from './windows';
import type { DetectedWindow } from '../../shared/types';
import type { VirtualWindowState } from './types';

function makeDetected(overrides: Partial<DetectedWindow> = {}): DetectedWindow {
  return {
    hwnd: '0x1',
    title: 'Window',
    processName: 'proc',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    isMinimized: false,
    isRestorable: true,
    ...overrides
  };
}

describe('hasUsableWindowBounds', () => {
  it('is true when all bounds are present and the window is restorable', () => {
    expect(hasUsableWindowBounds(makeDetected())).toBe(true);
  });

  it('is false when a bound is null', () => {
    expect(hasUsableWindowBounds(makeDetected({ x: null }))).toBe(false);
  });

  it('is false when the window is not restorable', () => {
    expect(hasUsableWindowBounds(makeDetected({ isRestorable: false }))).toBe(false);
  });
});

describe('toVirtualWindow', () => {
  it('returns null when the window has no usable bounds', () => {
    expect(toVirtualWindow(makeDetected({ width: null }))).toBeNull();
  });

  it('returns null when the window is internal', () => {
    expect(toVirtualWindow(makeDetected({ isInternal: true }))).toBeNull();
  });

  it('maps real coordinates to both real* and virtual* fields, and isIgnored to isHelper', () => {
    const result = toVirtualWindow(makeDetected({ x: 10, y: 20, width: 300, height: 200, isIgnored: true, statusReason: 'Ready' }));

    expect(result).toMatchObject({
      realX: 10,
      realY: 20,
      virtualX: 10,
      virtualY: 20,
      initialVirtualX: 10,
      initialVirtualY: 20,
      width: 300,
      height: 200,
      isDirty: false,
      isHelper: true,
      statusReason: 'Ready'
    });
  });
});

describe('toVirtualWindows', () => {
  it('filters out windows that cannot be converted', () => {
    const windows = [makeDetected({ hwnd: '0x1' }), makeDetected({ hwnd: '0x2', x: null }), makeDetected({ hwnd: '0x3' })];
    const result = toVirtualWindows(windows);
    expect(result.map((w) => w.hwnd)).toEqual(['0x1', '0x3']);
  });
});

describe('getVirtualWindowBounds', () => {
  it('returns null for an empty list', () => {
    expect(getVirtualWindowBounds([])).toBeNull();
  });

  it('computes the bounding box across all windows', () => {
    const windows: VirtualWindowState[] = [
      { title: 'A', processName: 'a', realX: 0, realY: 0, virtualX: 0, virtualY: 0, width: 100, height: 100 },
      { title: 'B', processName: 'b', realX: 0, realY: 0, virtualX: 200, virtualY: 150, width: 50, height: 50 }
    ];

    expect(getVirtualWindowBounds(windows)).toEqual({ x: 0, y: 0, width: 250, height: 200 });
  });
});

describe('createInitialVirtualLayout', () => {
  it('returns an empty array when there are no windows', () => {
    expect(createInitialVirtualLayout([])).toEqual([]);
  });

  it('places a single window centered at the default grid origin', () => {
    const result = createInitialVirtualLayout([makeDetected({ x: 500, y: 500, width: 200, height: 150 })]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ virtualX: 120, virtualY: 120, initialVirtualX: 120, initialVirtualY: 120, isDirty: false });
  });

  it('excludes helper (isIgnored) windows from the resulting layout', () => {
    const windows = [makeDetected({ hwnd: '0x1' }), makeDetected({ hwnd: '0x2', isIgnored: true })];
    const result = createInitialVirtualLayout(windows);

    expect(result.map((w) => w.hwnd)).toEqual(['0x1']);
  });

  it('produces internally consistent, non-dirty entries for every placed window', () => {
    const windows = [
      makeDetected({ hwnd: '0x1', x: 0, y: 0 }),
      makeDetected({ hwnd: '0x2', x: 400, y: 0 }),
      makeDetected({ hwnd: '0x3', x: 0, y: 400 })
    ];
    const result = createInitialVirtualLayout(windows);

    expect(result).toHaveLength(3);
    result.forEach((windowInfo) => {
      expect(windowInfo.isDirty).toBe(false);
      expect(windowInfo.virtualX).toBe(windowInfo.initialVirtualX);
      expect(windowInfo.virtualY).toBe(windowInfo.initialVirtualY);
    });
  });
});
