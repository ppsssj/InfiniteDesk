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

export function createInitialVirtualLayout(windows: DetectedWindow[]): VirtualWindowState[] {
  const initialWindows = toVirtualWindows(windows)
    .filter((windowInfo) => !windowInfo.isHelper)
    .sort((a, b) => {
      if (a.realY === b.realY) {
        return a.realX - b.realX;
      }

      return a.realY - b.realY;
    });

  if (initialWindows.length === 0) {
    return [];
  }

  const originX = 120;
  const originY = 120;
  const gapX = 260;
  const gapY = 220;
  const columnCount = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(initialWindows.length * 1.25))));
  const rows = Array.from({ length: Math.ceil(initialWindows.length / columnCount) }, (_row, rowIndex) =>
    initialWindows.slice(rowIndex * columnCount, rowIndex * columnCount + columnCount)
  );
  const columnWidths = Array.from({ length: columnCount }, (_column, columnIndex) =>
    Math.max(0, ...rows.flatMap((row) => (row[columnIndex] ? [row[columnIndex].width] : [])))
  );
  const rowHeights = rows.map((row) => Math.max(...row.map((windowInfo) => windowInfo.height)));
  const columnOffsets = columnWidths.reduce<number[]>((offsets, width, index) => {
    const previousOffset = offsets[index - 1] ?? originX;
    const previousWidth = columnWidths[index - 1] ?? 0;
    return [...offsets, index === 0 ? originX : previousOffset + previousWidth + gapX];
  }, []);

  let rowOffset = originY;
  return rows.flatMap((row, rowIndex) => {
    const placed = row.map((windowInfo, columnIndex) => {
      const virtualX = Math.round(columnOffsets[columnIndex] + (columnWidths[columnIndex] - windowInfo.width) / 2);
      const virtualY = Math.round(rowOffset + (rowHeights[rowIndex] - windowInfo.height) / 2);

      return {
        ...windowInfo,
        virtualX,
        virtualY,
        initialVirtualX: virtualX,
        initialVirtualY: virtualY,
        isDirty: false
      };
    });
    rowOffset += rowHeights[rowIndex] + gapY;
    return placed;
  });
}
