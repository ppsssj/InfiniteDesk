import { describe, expect, it } from 'vitest';
import { getSafeCanvasBounds, getWindowKey, intersectRects, normalizeDraftRegion, rectsIntersect, subtractRect } from './CanvasPreview.helpers';
import type { TemplateRegion, VirtualWindowState } from '../canvas/types';

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

describe('getWindowKey', () => {
  it('uses the hwnd when present', () => {
    expect(getWindowKey(makeWindow({ hwnd: '0x1' }), 3)).toBe('0x1');
  });

  it('falls back to processName-title-index when hwnd is absent', () => {
    expect(getWindowKey(makeWindow({ processName: 'code', title: 'main.tsx' }), 3)).toBe('code-main.tsx-3');
  });
});

describe('normalizeDraftRegion', () => {
  function makeRegion(overrides: Partial<TemplateRegion> = {}): TemplateRegion {
    return { id: 'draft', name: 'New Template', x: 100, y: 100, width: 50, height: 50, windowIds: [], createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
  }

  it('leaves an already-positive draft region untouched other than rounding', () => {
    const result = normalizeDraftRegion(makeRegion({ x: 10.4, y: 20.6, width: 50.2, height: 30.9 }));
    expect(result).toMatchObject({ x: 10, y: 21, width: 50, height: 31 });
  });

  it('flips a negative-width drag (dragged leftward) into a positive-width region anchored correctly', () => {
    const result = normalizeDraftRegion(makeRegion({ x: 100, y: 100, width: -40, height: 50 }));
    expect(result).toMatchObject({ x: 60, y: 100, width: 40, height: 50 });
  });

  it('flips a negative-height drag (dragged upward) into a positive-height region anchored correctly', () => {
    const result = normalizeDraftRegion(makeRegion({ x: 100, y: 100, width: 50, height: -30 }));
    expect(result).toMatchObject({ x: 100, y: 70, width: 50, height: 30 });
  });
});

describe('rectsIntersect', () => {
  it('returns true for overlapping rects', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 20, height: 20 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
  });

  it('returns false for rects that do not overlap', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 100, width: 10, height: 10 })).toBe(false);
  });

  it('treats exactly touching edges as not intersecting', () => {
    expect(rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe('intersectRects', () => {
  it('computes the overlapping rect', () => {
    const result = intersectRects({ x: 0, y: 0, width: 20, height: 20 }, { x: 10, y: 10, width: 20, height: 20 });
    expect(result).toEqual({ x: 10, y: 10, width: 10, height: 10 });
  });

  it('returns null when the rects do not overlap', () => {
    expect(intersectRects({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 100, width: 10, height: 10 })).toBeNull();
  });
});

describe('subtractRect', () => {
  it('returns the base rect unchanged when the cut does not overlap it', () => {
    const base = { x: 0, y: 0, width: 100, height: 100 };
    expect(subtractRect(base, { x: 200, y: 200, width: 10, height: 10 })).toEqual([base]);
  });

  it('splits the base rect into the surrounding pieces when a centered cut overlaps it', () => {
    const base = { x: 0, y: 0, width: 100, height: 100 };
    const cut = { x: 40, y: 40, width: 20, height: 20 };

    const pieces = subtractRect(base, cut);

    expect(pieces).toHaveLength(4);
    expect(pieces).toContainEqual({ x: 0, y: 0, width: 100, height: 40 });
    expect(pieces).toContainEqual({ x: 0, y: 60, width: 100, height: 40 });
    expect(pieces).toContainEqual({ x: 0, y: 40, width: 40, height: 20 });
    expect(pieces).toContainEqual({ x: 60, y: 40, width: 40, height: 20 });

    const totalArea = pieces.reduce((sum, rect) => sum + rect.width * rect.height, 0);
    expect(totalArea).toBe(base.width * base.height - cut.width * cut.height);
  });
});

describe('getSafeCanvasBounds', () => {
  it('clamps a safeArea smaller than the minimum margins', () => {
    const result = getSafeCanvasBounds(2000, 2000, { left: 100, top: 50, right: 100, bottom: 50 });
    expect(result).toEqual({
      safeLeft: 280,
      safeTop: 120,
      safeRight: 280,
      safeBottom: 140,
      safeWidth: 1440,
      safeHeight: 1740,
      safeCenterX: 1000,
      safeCenterY: 990
    });
  });

  it('uses the provided safeArea when it exceeds the minimum margins', () => {
    const result = getSafeCanvasBounds(2000, 2000, { left: 400, top: 300, right: 400, bottom: 300 });
    expect(result).toEqual({
      safeLeft: 400,
      safeTop: 300,
      safeRight: 400,
      safeBottom: 300,
      safeWidth: 1200,
      safeHeight: 1400,
      safeCenterX: 1000,
      safeCenterY: 1000
    });
  });
});
