import type { RefObject } from 'react';
import { worldToScreen, type CanvasTransform } from '../canvas/transform';
import type { VirtualWindowState } from '../canvas/types';
import type { MoveEmbeddedWindowParams } from '../../shared/types';
import type { ScreenRect } from '../components/CanvasPreview.types';
import { rectsIntersect, intersectRects, subtractRect } from '../components/CanvasPreview.helpers';
import {
  HIDDEN_EMBEDDED_WINDOW_X,
  HIDDEN_EMBEDDED_WINDOW_Y,
  NATIVE_EMBEDDED_VISIBLE_SCALE,
  OVERVIEW_FRAME_BORDER_WIDTH,
  getOverviewChromeMetrics
} from '../components/CanvasPreview.constants';

export type UseWindowFrameGeometryParams = {
  canvasRef: RefObject<HTMLDivElement | null>;
  transform: CanvasTransform;
  embeddedWindowIdSet: Set<string>;
  shouldSuspendNativePreviews: boolean;
};

export function useWindowFrameGeometry({
  canvasRef,
  transform,
  embeddedWindowIdSet,
  shouldSuspendNativePreviews
}: UseWindowFrameGeometryParams): {
  isEmbeddedWindow: (windowInfo: VirtualWindowState, forceEmbedded?: boolean) => boolean;
  shouldShowNativeEmbeddedWindow: (windowInfo: VirtualWindowState, forceEmbedded?: boolean, targetTransform?: CanvasTransform) => boolean;
  getVisiblePreviewRects: (previewBounds: ScreenRect, canvasWidth: number, canvasHeight: number) => ScreenRect[];
  getProtectedUiRects: () => ScreenRect[];
  intersectsProtectedUi: (rect: ScreenRect) => boolean;
  getAspectPreservingOverviewContentSize: (windowInfo: VirtualWindowState, targetTransform?: CanvasTransform) => { width: number; height: number };
  getFrameScreenBounds: (windowInfo: VirtualWindowState, forceEmbedded?: boolean, targetTransform?: CanvasTransform) => { x: number; y: number; width: number; height: number };
  getOverviewContentScreenBounds: (windowInfo: VirtualWindowState) => { x: number; y: number; width: number; height: number };
  getEmbeddedContentBounds: (windowInfo: VirtualWindowState, forceEmbedded?: boolean, targetTransform?: CanvasTransform) => MoveEmbeddedWindowParams;
} {
  function isEmbeddedWindow(windowInfo: VirtualWindowState, forceEmbedded = false): boolean {
    return forceEmbedded || Boolean(windowInfo.hwnd && embeddedWindowIdSet.has(windowInfo.hwnd));
  }

  function shouldShowNativeEmbeddedWindow(
    windowInfo: VirtualWindowState,
    forceEmbedded = false,
    targetTransform: CanvasTransform = transform
  ): boolean {
    return (
      (forceEmbedded || !shouldSuspendNativePreviews) &&
      isEmbeddedWindow(windowInfo, forceEmbedded) &&
      targetTransform.scale >= NATIVE_EMBEDDED_VISIBLE_SCALE
    );
  }

  function getProtectedUiRects(): ScreenRect[] {
    const canvas = canvasRef.current;
    if (!canvas) {
      return [];
    }

    const canvasRect = canvas.getBoundingClientRect();
    const padding = 1;
    return Array.from(document.querySelectorAll<HTMLElement>('[data-dwm-ui-overlay="true"]')).flatMap((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) {
        return [];
      }

      const protectedRect = {
        x: rect.left - canvasRect.left - padding,
        y: rect.top - canvasRect.top - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2
      };
      return intersectRects(protectedRect, { x: 0, y: 0, width: canvas.clientWidth, height: canvas.clientHeight })
        ? [protectedRect]
        : [];
    });
  }

  function intersectsProtectedUi(rect: ScreenRect): boolean {
    return getProtectedUiRects().some((protectedRect) => rectsIntersect(rect, protectedRect));
  }

  function getVisiblePreviewRects(previewBounds: ScreenRect, canvasWidth: number, canvasHeight: number): ScreenRect[] {
    const canvasBounds = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
    const insideCanvas = intersectRects(previewBounds, canvasBounds);
    if (!insideCanvas) {
      return [];
    }

    const visibleRects = getProtectedUiRects().reduce<ScreenRect[]>(
      (rects, protectedRect) => rects.flatMap((rect) => subtractRect(rect, protectedRect)),
      [insideCanvas]
    );

    return visibleRects.filter((rect) => rect.width > 20 && rect.height > 20);
  }

  function getAspectPreservingOverviewContentSize(
    windowInfo: VirtualWindowState,
    targetTransform: CanvasTransform = transform
  ): { width: number; height: number } {
    const sourceWidth = Math.max(1, windowInfo.width);
    const sourceHeight = Math.max(1, windowInfo.height);
    const previewScale = Math.max(0.001, targetTransform.scale);

    return {
      width: Math.max(1, Math.round(sourceWidth * previewScale)),
      height: Math.max(1, Math.round(sourceHeight * previewScale))
    };
  }

  function getFrameScreenBounds(
    windowInfo: VirtualWindowState,
    forceEmbedded = false,
    targetTransform: CanvasTransform = transform
  ): { x: number; y: number; width: number; height: number } {
    const position = worldToScreen(windowInfo.virtualX, windowInfo.virtualY, targetTransform);
    const contentSize = getAspectPreservingOverviewContentSize(windowInfo, targetTransform);
    const chrome = getOverviewChromeMetrics(targetTransform.scale);

    return {
      x: position.x,
      y: position.y,
      width: contentSize.width + (chrome.contentInset + OVERVIEW_FRAME_BORDER_WIDTH) * 2,
      height: contentSize.height + chrome.titlebarHeight + (chrome.contentInset + OVERVIEW_FRAME_BORDER_WIDTH) * 2
    };
  }

  function getOverviewContentScreenBounds(
    windowInfo: VirtualWindowState,
    targetTransform: CanvasTransform = transform
  ): { x: number; y: number; width: number; height: number } {
    const frame = getFrameScreenBounds(windowInfo, false, targetTransform);
    const contentSize = getAspectPreservingOverviewContentSize(windowInfo, targetTransform);
    const chrome = getOverviewChromeMetrics(targetTransform.scale);

    return {
      x: frame.x + OVERVIEW_FRAME_BORDER_WIDTH + chrome.contentInset,
      y: frame.y + OVERVIEW_FRAME_BORDER_WIDTH + chrome.titlebarHeight + chrome.contentInset,
      width: contentSize.width,
      height: contentSize.height
    };
  }

  function getEmbeddedContentBounds(
    windowInfo: VirtualWindowState,
    forceEmbedded = false,
    targetTransform: CanvasTransform = transform
  ): MoveEmbeddedWindowParams {
    const frame = getFrameScreenBounds(windowInfo, forceEmbedded, targetTransform);
    if (!shouldShowNativeEmbeddedWindow(windowInfo, forceEmbedded, targetTransform) || intersectsProtectedUi(frame)) {
      return {
        hwnd: windowInfo.hwnd || '',
        x: HIDDEN_EMBEDDED_WINDOW_X,
        y: HIDDEN_EMBEDDED_WINDOW_Y,
        width: Math.max(1, Math.round(windowInfo.width)),
        height: Math.max(1, Math.round(windowInfo.height))
      };
    }

    const content = getOverviewContentScreenBounds(windowInfo, targetTransform);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const canvasOffsetX = canvasRect?.left || 0;
    const canvasOffsetY = canvasRect?.top || 0;

    return {
      hwnd: windowInfo.hwnd || '',
      x: Math.round(canvasOffsetX + content.x),
      y: Math.round(canvasOffsetY + content.y),
      width: Math.max(1, Math.round(content.width)),
      height: Math.max(1, Math.round(content.height))
    };
  }

  return {
    isEmbeddedWindow,
    shouldShowNativeEmbeddedWindow,
    getVisiblePreviewRects,
    getProtectedUiRects,
    intersectsProtectedUi,
    getAspectPreservingOverviewContentSize,
    getFrameScreenBounds,
    getOverviewContentScreenBounds,
    getEmbeddedContentBounds
  };
}
