import { useEffect, useRef, type RefObject } from 'react';
import type { CanvasSafeArea, CanvasTransform } from '../canvas/transform';
import type { VirtualWindowState } from '../canvas/types';
import type { MoveEmbeddedWindowParams } from '../../shared/types';
import { EMBEDDED_MOVE_THROTTLE_MS } from '../components/CanvasPreview.constants';

export type UseEmbeddedWindowSyncParams = {
  windows: VirtualWindowState[];
  windowsRef: RefObject<VirtualWindowState[]>;
  embeddedWindowIds: string[];
  embeddedWindowIdSet: Set<string>;
  onMoveEmbeddedWindow: (params: MoveEmbeddedWindowParams) => void;
  getEmbeddedContentBounds: (windowInfo: VirtualWindowState, forceEmbedded?: boolean, targetTransform?: CanvasTransform) => MoveEmbeddedWindowParams;
  safeArea: CanvasSafeArea;
  transform: CanvasTransform;
  shouldSuspendNativePreviews: boolean;
};

export function useEmbeddedWindowSync({
  windows,
  windowsRef,
  embeddedWindowIds,
  embeddedWindowIdSet,
  onMoveEmbeddedWindow,
  getEmbeddedContentBounds,
  safeArea,
  transform,
  shouldSuspendNativePreviews
}: UseEmbeddedWindowSyncParams): {
  scheduleEmbeddedMove: (params: MoveEmbeddedWindowParams, immediate?: boolean) => void;
  flushEmbeddedWindowPositions: () => void;
} {
  const embeddedMoveRef = useRef<Record<string, { lastMoveAt: number; timeoutId: number | null; latest: MoveEmbeddedWindowParams | null }>>({});

  useEffect(() => {
    return () => {
      Object.values(embeddedMoveRef.current).forEach((item) => {
        if (item.timeoutId !== null) {
          window.clearTimeout(item.timeoutId);
        }
      });
    };
  }, []);

  function scheduleEmbeddedMove(params: MoveEmbeddedWindowParams, immediate = false): void {
    if (!params.hwnd) {
      return;
    }

    const key = params.hwnd;
    const now = window.performance.now();
    const existing = embeddedMoveRef.current[key] || { lastMoveAt: 0, timeoutId: null, latest: null };
    const elapsed = now - existing.lastMoveAt;

    if (immediate || elapsed >= EMBEDDED_MOVE_THROTTLE_MS) {
      if (existing.timeoutId !== null) {
        window.clearTimeout(existing.timeoutId);
      }
      embeddedMoveRef.current[key] = {
        lastMoveAt: now,
        timeoutId: null,
        latest: params
      };
      onMoveEmbeddedWindow(params);
      return;
    }

    if (existing.timeoutId !== null) {
      window.clearTimeout(existing.timeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      const latest = embeddedMoveRef.current[key]?.latest || params;
      embeddedMoveRef.current[key] = {
        lastMoveAt: window.performance.now(),
        timeoutId: null,
        latest
      };
      onMoveEmbeddedWindow(latest);
    }, EMBEDDED_MOVE_THROTTLE_MS - elapsed);

    embeddedMoveRef.current[key] = {
      ...existing,
      timeoutId,
      latest: params
    };
  }

  function flushEmbeddedWindowPositions(): void {
    if (embeddedWindowIds.length === 0) {
      return;
    }

    windowsRef.current.forEach((windowInfo) => {
      if (!windowInfo.hwnd || !embeddedWindowIdSet.has(windowInfo.hwnd)) {
        return;
      }

      scheduleEmbeddedMove(getEmbeddedContentBounds(windowInfo), true);
    });
  }

  useEffect(() => {
    if (embeddedWindowIds.length === 0) {
      return;
    }

    windows.forEach((windowInfo) => {
      if (!windowInfo.hwnd || !embeddedWindowIdSet.has(windowInfo.hwnd)) {
        return;
      }

      scheduleEmbeddedMove(getEmbeddedContentBounds(windowInfo));
    });
  }, [embeddedWindowIdSet, embeddedWindowIds.length, shouldSuspendNativePreviews, safeArea, transform, windows]);

  return { scheduleEmbeddedMove, flushEmbeddedWindowPositions };
}
