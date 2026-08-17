import type { CanvasTransform } from '../canvas/transform';

export const DEFAULT_TRANSFORM: CanvasTransform = {
  offsetX: 120,
  offsetY: 96,
  scale: 0.2
};
export const MIN_REGION_WIDTH = 200;
export const MIN_REGION_HEIGHT = 140;
export const DEFAULT_REGION_WIDTH = 420;
export const DEFAULT_REGION_HEIGHT = 280;
export const REGION_COLORS = ['#2f7666', '#8a3f2f', '#6f5520', '#4d6793', '#7a5b8f'];
export const EMBEDDED_MOVE_THROTTLE_MS = 50;
export const NATIVE_EMBEDDED_VISIBLE_SCALE = 0.01;
export const HIDDEN_EMBEDDED_WINDOW_X = -30000;
export const HIDDEN_EMBEDDED_WINDOW_Y = -30000;
export const OVERVIEW_TITLEBAR_HEIGHT = 32;
export const OVERVIEW_CONTENT_INSET = 0;
export const OVERVIEW_FRAME_BORDER_WIDTH = 1;
export const COMPACT_OVERVIEW_SCALE = 0.18;
export const COMPACT_OVERVIEW_CONTENT_INSET = 0;

export function getOverviewChromeMetrics(scale: number): { titlebarHeight: number; contentInset: number } {
  if (scale < COMPACT_OVERVIEW_SCALE) {
    return {
      titlebarHeight: 0,
      contentInset: COMPACT_OVERVIEW_CONTENT_INSET
    };
  }

  return {
    titlebarHeight: OVERVIEW_TITLEBAR_HEIGHT,
    contentInset: OVERVIEW_CONTENT_INSET
  };
}
