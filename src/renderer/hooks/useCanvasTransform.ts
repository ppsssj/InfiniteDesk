import { useEffect, useState, type RefObject } from 'react';
import { fitViewToWindows, clampScale, screenToWorld, type CanvasSafeArea, type CanvasTransform } from '../canvas/transform';
import type { VirtualWindowState } from '../canvas/types';
import { DEFAULT_TRANSFORM } from '../components/CanvasPreview.constants';

export type UseCanvasTransformParams = {
  canvasRef: RefObject<HTMLDivElement | null>;
  windows: VirtualWindowState[];
  safeArea: CanvasSafeArea;
  fitSignal: number;
  resetViewSignal: number;
  zoomInSignal: number;
  zoomOutSignal: number;
  actualSizeSignal: number;
  onZoomChange: (scale: number) => void;
};

export function useCanvasTransform({
  canvasRef,
  windows,
  safeArea,
  fitSignal,
  resetViewSignal,
  zoomInSignal,
  zoomOutSignal,
  actualSizeSignal,
  onZoomChange
}: UseCanvasTransformParams): {
  transform: CanvasTransform;
  setTransform: (next: CanvasTransform | ((current: CanvasTransform) => CanvasTransform)) => void;
  fitView: () => void;
  zoomBy: (multiplier: number) => void;
  getDefaultTransform: () => CanvasTransform;
} {
  const [transform, setTransformState] = useState<CanvasTransform>(DEFAULT_TRANSFORM);

  function getDefaultTransform(): CanvasTransform {
    return {
      ...DEFAULT_TRANSFORM,
      offsetX: Math.max(DEFAULT_TRANSFORM.offsetX, safeArea.left + 40),
      offsetY: Math.max(DEFAULT_TRANSFORM.offsetY, safeArea.top + 32)
    };
  }

  function setTransform(next: CanvasTransform | ((current: CanvasTransform) => CanvasTransform)): void {
    setTransformState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      return resolved;
    });
  }

  function fitView(): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      setTransform(getDefaultTransform());
      return;
    }

    const rect = canvas.getBoundingClientRect();
    setTransform(fitViewToWindows(windows, rect.width, rect.height, safeArea));
  }

  function zoomBy(multiplier: number): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = rect.width / 2;
    const screenY = rect.height / 2;
    setTransform((current) => {
      const nextScale = clampScale(current.scale * multiplier);
      const worldPoint = screenToWorld(screenX, screenY, current);
      return {
        scale: nextScale,
        offsetX: screenX - worldPoint.x * nextScale,
        offsetY: screenY - worldPoint.y * nextScale
      };
    });
  }

  function showActualSize(): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = rect.width / 2;
    const screenY = rect.height / 2;
    setTransform((current) => {
      const worldPoint = screenToWorld(screenX, screenY, current);
      return {
        scale: 1,
        offsetX: screenX - worldPoint.x,
        offsetY: screenY - worldPoint.y
      };
    });
  }

  useEffect(() => {
    onZoomChange(transform.scale);
  }, [onZoomChange, transform.scale]);

  useEffect(() => {
    fitView();
  }, [fitSignal]);

  useEffect(() => {
    setTransform(getDefaultTransform());
  }, [resetViewSignal]);

  useEffect(() => {
    if (zoomInSignal > 0) {
      zoomBy(1.12);
    }
  }, [zoomInSignal]);

  useEffect(() => {
    if (zoomOutSignal > 0) {
      zoomBy(0.88);
    }
  }, [zoomOutSignal]);

  useEffect(() => {
    if (actualSizeSignal > 0) {
      showActualSize();
    }
  }, [actualSizeSignal]);

  return { transform, setTransform, fitView, zoomBy, getDefaultTransform };
}
