export type CanvasTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export type CanvasSafeArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export const MIN_CANVAS_SCALE = 0.01;
export const MAX_CANVAS_SCALE = 2.5;
const DEFAULT_CANVAS_SCALE = 0.2;
const MAX_FIT_SCALE = 0.25;
const EMPTY_SAFE_AREA: CanvasSafeArea = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0
};

export function clampScale(scale: number): number {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
}

export function easeOutCubic(progress: number): number {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - clampedProgress, 3);
}

export function interpolateCanvasTransform(
  from: CanvasTransform,
  to: CanvasTransform,
  progress: number
): CanvasTransform {
  const clampedProgress = Math.min(1, Math.max(0, progress));
  return {
    offsetX: from.offsetX + (to.offsetX - from.offsetX) * clampedProgress,
    offsetY: from.offsetY + (to.offsetY - from.offsetY) * clampedProgress,
    scale: from.scale + (to.scale - from.scale) * clampedProgress
  };
}

export function worldToScreen(x: number, y: number, transform: CanvasTransform): { x: number; y: number } {
  return {
    x: x * transform.scale + transform.offsetX,
    y: y * transform.scale + transform.offsetY
  };
}

export function screenToWorld(x: number, y: number, transform: CanvasTransform): { x: number; y: number } {
  return {
    x: (x - transform.offsetX) / transform.scale,
    y: (y - transform.offsetY) / transform.scale
  };
}

export function fitViewToBounds(
  bounds: { x: number; y: number; width: number; height: number },
  containerWidth: number,
  containerHeight: number,
  padding = 240,
  safeArea: CanvasSafeArea = EMPTY_SAFE_AREA
): CanvasTransform {
  const safeWidth = Math.max(1, containerWidth - safeArea.left - safeArea.right);
  const safeHeight = Math.max(1, containerHeight - safeArea.top - safeArea.bottom);
  const availableWidth = Math.max(1, safeWidth - padding * 2);
  const availableHeight = Math.max(1, safeHeight - padding * 2);
  const nextScale = clampScale(Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height), MAX_FIT_SCALE));
  const safeCenterX = safeArea.left + safeWidth / 2;
  const safeCenterY = safeArea.top + safeHeight / 2;

  return {
    scale: nextScale,
    offsetX: safeCenterX - (bounds.x + bounds.width / 2) * nextScale,
    offsetY: safeCenterY - (bounds.y + bounds.height / 2) * nextScale
  };
}

export function fitViewToWindows(
  windows: Array<{ virtualX: number; virtualY: number; width: number; height: number }>,
  containerWidth: number,
  containerHeight: number,
  safeArea: CanvasSafeArea = EMPTY_SAFE_AREA
): CanvasTransform {
  if (windows.length === 0) {
    return {
      offsetX: Math.max(120, safeArea.left + 40),
      offsetY: Math.max(96, safeArea.top + 32),
      scale: DEFAULT_CANVAS_SCALE
    };
  }

  const minX = Math.min(...windows.map((windowInfo) => windowInfo.virtualX));
  const minY = Math.min(...windows.map((windowInfo) => windowInfo.virtualY));
  const maxX = Math.max(...windows.map((windowInfo) => windowInfo.virtualX + windowInfo.width));
  const maxY = Math.max(...windows.map((windowInfo) => windowInfo.virtualY + windowInfo.height));

  return fitViewToBounds(
    {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    },
    containerWidth,
    containerHeight,
    undefined,
    safeArea
  );
}
