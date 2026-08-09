import { describe, expect, it } from 'vitest';
import {
  clampScale,
  fitViewToBounds,
  fitViewToWindows,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  screenToWorld,
  worldToScreen,
  type CanvasTransform
} from './transform';

describe('clampScale', () => {
  it('clamps values below MIN_CANVAS_SCALE', () => {
    expect(clampScale(0.001)).toBe(MIN_CANVAS_SCALE);
  });

  it('clamps values above MAX_CANVAS_SCALE', () => {
    expect(clampScale(5)).toBe(MAX_CANVAS_SCALE);
  });

  it('passes through values already in range', () => {
    expect(clampScale(1)).toBe(1);
  });
});

describe('worldToScreen / screenToWorld', () => {
  const transform: CanvasTransform = { offsetX: 100, offsetY: 50, scale: 0.5 };

  it('converts world coordinates to screen coordinates', () => {
    expect(worldToScreen(40, 60, transform)).toEqual({ x: 120, y: 80 });
  });

  it('round-trips screen coordinates back to the original world coordinates', () => {
    const screen = worldToScreen(40, 60, transform);
    expect(screenToWorld(screen.x, screen.y, transform)).toEqual({ x: 40, y: 60 });
  });
});

describe('fitViewToBounds', () => {
  it('caps the computed scale at MAX_FIT_SCALE when bounds are small relative to the container', () => {
    const result = fitViewToBounds({ x: 0, y: 0, width: 1000, height: 1000 }, 2000, 2000);

    expect(result.scale).toBe(0.25);
    expect(result.offsetX).toBe(875);
    expect(result.offsetY).toBe(875);
  });

  it('respects safeArea when computing the centered offset and an uncapped scale', () => {
    const result = fitViewToBounds(
      { x: 0, y: 0, width: 10000, height: 8000 },
      1000,
      1000,
      0,
      { left: 100, top: 50, right: 100, bottom: 50 }
    );

    expect(result.scale).toBeCloseTo(0.08);
    expect(result.offsetX).toBeCloseTo(100);
    expect(result.offsetY).toBeCloseTo(180);
  });
});

describe('fitViewToWindows', () => {
  it('returns the default transform when there are no windows', () => {
    expect(fitViewToWindows([], 1000, 800)).toEqual({
      offsetX: 120,
      offsetY: 96,
      scale: 0.2
    });
  });

  it('respects safeArea when falling back to the default transform', () => {
    const result = fitViewToWindows([], 1000, 800, { left: 200, top: 100, right: 0, bottom: 0 });
    expect(result).toEqual({ offsetX: 240, offsetY: 132, scale: 0.2 });
  });

  it('computes the bounding box of all windows and delegates to fitViewToBounds', () => {
    const windows = [
      { virtualX: 0, virtualY: 0, width: 100, height: 100 },
      { virtualX: 200, virtualY: 150, width: 50, height: 50 }
    ];
    const safeArea = { left: 10, top: 10, right: 10, bottom: 10 };

    const result = fitViewToWindows(windows, 1000, 800, safeArea);
    const expected = fitViewToBounds({ x: 0, y: 0, width: 250, height: 200 }, 1000, 800, undefined, safeArea);

    expect(result).toEqual(expected);
  });
});
