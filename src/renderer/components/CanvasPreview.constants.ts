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
export const EMBEDDED_NODE_CHROME_WIDTH = 16;
export const EMBEDDED_NODE_CHROME_HEIGHT = 54;
export const EMBEDDED_NODE_CONTENT_INSET_X = 8;
export const EMBEDDED_NODE_CONTENT_INSET_TOP = 46;
export const EMBEDDED_NODE_CONTENT_INSET_BOTTOM = 8;
export const NATIVE_EMBEDDED_VISIBLE_SCALE = 0.01;
export const INTERACTIVE_EMBED_SCALE = 0.78;
export const HIDDEN_EMBEDDED_WINDOW_X = -30000;
export const HIDDEN_EMBEDDED_WINDOW_Y = -30000;
export const OVERVIEW_TITLEBAR_HEIGHT = 38;
export const OVERVIEW_CONTENT_INSET = 10;
export const MIN_OVERVIEW_CONTENT_WIDTH = 160;
export const MIN_OVERVIEW_CONTENT_HEIGHT = 92;
