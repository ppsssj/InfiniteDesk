import type { LayoutTemplate } from '../../shared/types';
import type { TemplateRegion, VirtualWindowState } from './types';
import { getVirtualWindowBounds, toVirtualWindows } from './windows';

const REGION_PADDING = 80;

export function getWindowIdentity(windowInfo: VirtualWindowState): string {
  return windowInfo.hwnd || `${windowInfo.processName}:${windowInfo.title}`;
}

export function isWindowInsideRegion(windowInfo: VirtualWindowState, region: TemplateRegion): boolean {
  const centerX = windowInfo.virtualX + windowInfo.width / 2;
  const centerY = windowInfo.virtualY + windowInfo.height / 2;

  return (
    centerX >= region.x &&
    centerX <= region.x + region.width &&
    centerY >= region.y &&
    centerY <= region.y + region.height
  );
}

export function updateRegionMembership(
  windows: VirtualWindowState[],
  regions: TemplateRegion[]
): TemplateRegion[] {
  return regions.map((region, regionIndex) => {
    const windowIds = windows.flatMap((windowInfo) => {
      let containingRegionIndex = -1;
      regions.forEach((candidate, candidateIndex) => {
        if (isWindowInsideRegion(windowInfo, candidate)) {
          containingRegionIndex = candidateIndex;
        }
      });
      return containingRegionIndex === regionIndex ? [getWindowIdentity(windowInfo)] : [];
    });

    return {
      ...region,
      windowIds
    };
  });
}

export function getWindowsForRegion(windows: VirtualWindowState[], region: TemplateRegion): VirtualWindowState[] {
  const ids = new Set(region.windowIds);
  return windows.filter((windowInfo) => ids.has(getWindowIdentity(windowInfo)));
}

export function createRegionFromTemplate(template: LayoutTemplate): {
  region: TemplateRegion | null;
  windows: VirtualWindowState[];
} {
  const windows = toVirtualWindows(template.windows);
  const bounds = getVirtualWindowBounds(windows);

  if (!bounds) {
    return { region: null, windows };
  }

  const region: TemplateRegion = {
    id: template.id,
    name: template.name,
    x: Math.round(bounds.x - REGION_PADDING),
    y: Math.round(bounds.y - REGION_PADDING),
    width: Math.round(bounds.width + REGION_PADDING * 2),
    height: Math.round(bounds.height + REGION_PADDING * 2),
    windowIds: windows.map(getWindowIdentity),
    createdAt: template.createdAt,
    isDirty: false
  };

  return { region, windows };
}
