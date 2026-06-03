import type { DetectedWindow } from '../../shared/types';
import type { VirtualWindowState } from './types';

export function hasUsableWindowBounds(windowInfo: DetectedWindow): windowInfo is DetectedWindow & {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return (
    windowInfo.x !== null &&
    windowInfo.y !== null &&
    windowInfo.width !== null &&
    windowInfo.height !== null &&
    windowInfo.isRestorable
  );
}

export function toVirtualWindow(windowInfo: DetectedWindow): VirtualWindowState | null {
  if (!hasUsableWindowBounds(windowInfo) || windowInfo.isInternal) {
    return null;
  }

  return {
    hwnd: windowInfo.hwnd,
    title: windowInfo.title,
    processName: windowInfo.processName,
    realX: windowInfo.x,
    realY: windowInfo.y,
    virtualX: windowInfo.x,
    virtualY: windowInfo.y,
    width: windowInfo.width,
    height: windowInfo.height,
    initialVirtualX: windowInfo.x,
    initialVirtualY: windowInfo.y,
    isDirty: false,
    statusReason: windowInfo.statusReason,
    isHelper: windowInfo.isIgnored
  };
}

export function toVirtualWindows(windows: DetectedWindow[]): VirtualWindowState[] {
  return windows.flatMap((windowInfo) => {
    const virtualWindow = toVirtualWindow(windowInfo);
    return virtualWindow ? [virtualWindow] : [];
  });
}

export function getVirtualWindowBounds(windows: VirtualWindowState[]): { x: number; y: number; width: number; height: number } | null {
  if (windows.length === 0) {
    return null;
  }

  const minX = Math.min(...windows.map((windowInfo) => windowInfo.virtualX));
  const minY = Math.min(...windows.map((windowInfo) => windowInfo.virtualY));
  const maxX = Math.max(...windows.map((windowInfo) => windowInfo.virtualX + windowInfo.width));
  const maxY = Math.max(...windows.map((windowInfo) => windowInfo.virtualY + windowInfo.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function windowsOverlap(a: VirtualWindowState, b: VirtualWindowState): boolean {
  return !(
    a.virtualX + a.width < b.virtualX ||
    b.virtualX + b.width < a.virtualX ||
    a.virtualY + a.height < b.virtualY ||
    b.virtualY + b.height < a.virtualY
  );
}

export function createInitialVirtualLayout(windows: DetectedWindow[]): VirtualWindowState[] {
  const initialWindows = toVirtualWindows(windows).sort((a, b) => {
    if (a.realY === b.realY) {
      return a.realX - b.realX;
    }

    return a.realY - b.realY;
  });

  if (initialWindows.length === 0) {
    return [];
  }

  const minRealX = Math.min(...initialWindows.map((windowInfo) => windowInfo.realX));
  const minRealY = Math.min(...initialWindows.map((windowInfo) => windowInfo.realY));
  const originX = 120;
  const originY = 120;
  const overlapStep = 72;

  return initialWindows.reduce<VirtualWindowState[]>((placed, windowInfo, index) => {
    let virtualX = windowInfo.realX - minRealX + originX;
    let virtualY = windowInfo.realY - minRealY + originY;
    let candidate: VirtualWindowState = {
      ...windowInfo,
      virtualX,
      virtualY
    };

    let guard = 0;
    while (placed.some((placedWindow) => windowsOverlap(candidate, placedWindow)) && guard < 12) {
      virtualX += overlapStep;
      virtualY += overlapStep;
      candidate = {
        ...candidate,
        virtualX,
        virtualY
      };
      guard++;
    }

    const normalizedWindow: VirtualWindowState = {
      ...candidate,
      initialVirtualX: candidate.virtualX,
      initialVirtualY: candidate.virtualY,
      isDirty: false,
      virtualX: Math.round(candidate.virtualX),
      virtualY: Math.round(candidate.virtualY)
    };

    if (index > 0 && placed.length === 0) {
      return [normalizedWindow];
    }

    return [...placed, normalizedWindow];
  }, []);
}
