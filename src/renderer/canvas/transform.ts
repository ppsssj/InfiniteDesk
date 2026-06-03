export type CanvasTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export const MIN_CANVAS_SCALE = 0.01;
export const MAX_CANVAS_SCALE = 2.5;
const DEFAULT_CANVAS_SCALE = 0.2;
const MAX_FIT_SCALE = 0.25;

export function clampScale(scale: number): number {
  return Math.min(MAX_CANVAS_SCALE, Math.max(MIN_CANVAS_SCALE, scale));
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
  padding = 240
): CanvasTransform {
  const availableWidth = Math.max(1, containerWidth - padding * 2);
  const availableHeight = Math.max(1, containerHeight - padding * 2);
  const nextScale = clampScale(Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height), MAX_FIT_SCALE));

  return {
    scale: nextScale,
    offsetX: containerWidth / 2 - (bounds.x + bounds.width / 2) * nextScale,
    offsetY: containerHeight / 2 - (bounds.y + bounds.height / 2) * nextScale
  };
}

export function fitViewToWindows(
  windows: Array<{ virtualX: number; virtualY: number; width: number; height: number }>,
  containerWidth: number,
  containerHeight: number
): CanvasTransform {
  if (windows.length === 0) {
    return {
      offsetX: 120,
      offsetY: 96,
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
    containerHeight
  );
}
