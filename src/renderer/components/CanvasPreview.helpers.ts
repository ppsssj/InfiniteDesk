import type { CanvasSafeArea } from '../canvas/transform';
import type { TemplateRegion, VirtualWindowState } from '../canvas/types';
import type { ScreenRect } from './CanvasPreview.types';

export function getWindowKey(windowInfo: VirtualWindowState, index: number): string {
  return windowInfo.hwnd || `${windowInfo.processName}-${windowInfo.title}-${index}`;
}

export function normalizeDraftRegion(region: TemplateRegion): TemplateRegion {
  const x = region.width < 0 ? region.x + region.width : region.x;
  const y = region.height < 0 ? region.y + region.height : region.y;

  return {
    ...region,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.abs(region.width)),
    height: Math.round(Math.abs(region.height))
  };
}

export function rectsIntersect(a: ScreenRect, b: ScreenRect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

export function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function subtractRect(base: ScreenRect, cut: ScreenRect): ScreenRect[] {
  const overlap = intersectRects(base, cut);
  if (!overlap) {
    return [base];
  }

  return [
    { x: base.x, y: base.y, width: base.width, height: overlap.y - base.y },
    { x: base.x, y: overlap.y + overlap.height, width: base.width, height: base.y + base.height - overlap.y - overlap.height },
    { x: base.x, y: overlap.y, width: overlap.x - base.x, height: overlap.height },
    { x: overlap.x + overlap.width, y: overlap.y, width: base.x + base.width - overlap.x - overlap.width, height: overlap.height }
  ].filter((rect) => rect.width > 0 && rect.height > 0);
}

export function getSafeCanvasBounds(
  canvasWidth: number,
  canvasHeight: number,
  safeArea: CanvasSafeArea
): {
  safeLeft: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeWidth: number;
  safeHeight: number;
  safeCenterX: number;
  safeCenterY: number;
} {
  const safeLeft = Math.max(safeArea.left, 280);
  const safeTop = Math.max(safeArea.top, 120);
  const safeRight = Math.max(safeArea.right, 280);
  const safeBottom = Math.max(safeArea.bottom, 140);
  const safeWidth = Math.max(1, canvasWidth - safeLeft - safeRight);
  const safeHeight = Math.max(1, canvasHeight - safeTop - safeBottom);

  return {
    safeLeft,
    safeTop,
    safeRight,
    safeBottom,
    safeWidth,
    safeHeight,
    safeCenterX: safeLeft + safeWidth / 2,
    safeCenterY: safeTop + safeHeight / 2
  };
}
