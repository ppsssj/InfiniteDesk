import type { DetectedWindow, DockApp, RestoreResult, WorkspaceRegion } from '../../shared/types';
import type { TemplateRegion, VirtualWindowState } from './types';
import { getVirtualWindowBounds } from './windows';

export function virtualWindowToDetected(windowInfo: VirtualWindowState): DetectedWindow {
  return {
    hwnd: windowInfo.hwnd || '',
    title: windowInfo.title,
    processName: windowInfo.processName,
    x: Math.round(windowInfo.virtualX),
    y: Math.round(windowInfo.virtualY),
    width: Math.round(windowInfo.width),
    height: Math.round(windowInfo.height),
    isMinimized: false,
    isRestorable: true,
    isInternal: false,
    isIgnored: windowInfo.isHelper,
    statusReason: windowInfo.isHelper ? 'No useful preview' : 'Ready'
  };
}

export function restoreResultText(result: RestoreResult): string {
  const skippedText = result.skipped > 0 ? ` Skipped ${result.skipped}. ${result.errors.join(' ')}` : '';
  return `Restored ${result.restored} windows.${skippedText}`;
}

export function workspaceRegionToTemplateRegion(region: WorkspaceRegion): TemplateRegion {
  return {
    ...region,
    isDirty: false
  };
}

export function regionToWorkspaceRegion(region: TemplateRegion): WorkspaceRegion {
  return {
    id: region.id,
    name: region.name,
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
    windowIds: region.windowIds,
    color: region.color,
    createdAt: region.createdAt
  };
}

export function processMatchesDockApp(windowInfo: DetectedWindow, dockApp: DockApp): boolean {
  const expected = (dockApp.processName || dockApp.id).toLowerCase();
  const actual = windowInfo.processName.toLowerCase();
  return actual === expected || actual.includes(expected) || expected.includes(actual);
}

export function placeVirtualWindowInRegion(windowInfo: VirtualWindowState, region: TemplateRegion, index: number): VirtualWindowState {
  return {
    ...windowInfo,
    virtualX: Math.round(region.x + 36 + (index % 4) * 42),
    virtualY: Math.round(region.y + 72 + (index % 4) * 34),
    initialVirtualX: Math.round(region.x + 36 + (index % 4) * 42),
    initialVirtualY: Math.round(region.y + 72 + (index % 4) * 34),
    isDirty: true
  };
}

export function placeDetectedWindowsNearSource(
  detectedWindows: VirtualWindowState[],
  currentWindows: VirtualWindowState[],
  sourceHwnd: string
): VirtualWindowState[] {
  const sourceWindow = currentWindows.find((windowInfo) => windowInfo.hwnd === sourceHwnd);
  const currentBounds = getVirtualWindowBounds(currentWindows);
  const fallbackX = currentBounds ? currentBounds.x + currentBounds.width + 96 : 120;
  const fallbackY = currentBounds?.y ?? 120;

  return detectedWindows.map((windowInfo, index) => {
    const virtualX = Math.round(
      sourceWindow ? sourceWindow.virtualX + sourceWindow.width + 80 + (index % 3) * 56 : fallbackX + (index % 3) * 72
    );
    const virtualY = Math.round(sourceWindow ? sourceWindow.virtualY + index * 72 : fallbackY + index * 72);
    return {
      ...windowInfo,
      virtualX,
      virtualY,
      initialVirtualX: virtualX,
      initialVirtualY: virtualY,
      isDirty: false
    };
  });
}
