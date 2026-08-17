import { app, screen, type Display } from 'electron';
import type { EmbedResult, MoveEmbeddedWindowParams } from '../shared/types';
import { sendDwmPreviewCommand } from './dwm-preview-client';
import { sendWindowControlCommand } from './window-control-client';

type WindowPlacementSnapshot = {
  flags: number;
  showCmd: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  normalLeft: number;
  normalTop: number;
  normalRight: number;
  normalBottom: number;
};

type VirtualAttachHostResult = {
  success: boolean;
  hwnd: string;
  originalPlacement?: WindowPlacementSnapshot;
  error?: string;
};

type VirtualizedWindow = {
  hwnd: string;
  originalPlacement: WindowPlacementSnapshot;
  displayId: number;
};

const virtualizedWindows = new Map<string, VirtualizedWindow>();
const pendingVirtualAttaches = new Map<string, Promise<EmbedResult>>();

function normalizedHwnd(hwnd: string): string {
  return hwnd.trim().toLowerCase();
}

function displaySortValue(display: Display): number {
  return display.bounds.x * 100_000 + display.bounds.y;
}

function findVirtualDisplay(): Display | null {
  const displays = screen.getAllDisplays();
  const namedDisplay = displays.find((display) => display.label.toLowerCase().includes('infinitedesk'));
  if (namedDisplay) {
    return namedDisplay;
  }

  // The current development driver still exposes the sample EDID name. Its
  // monitor is added to the far-right edge by Windows, so allow that fallback
  // only in an unpackaged build with at least two physical displays present.
  // Production builds require the customized InfiniteDesk EDID label.
  if (!app.isPackaged && displays.length >= 3) {
    return [...displays].sort((left, right) => displaySortValue(right) - displaySortValue(left))[0] || null;
  }

  return null;
}

export function hasVirtualizedWindow(hwnd: string): boolean {
  return virtualizedWindows.has(normalizedHwnd(hwnd));
}

export function getVirtualizedWindowCount(): number {
  return virtualizedWindows.size;
}

export function attachWindowToVirtualDisplay(hwnd: string): Promise<EmbedResult> {
  const key = normalizedHwnd(hwnd);
  if (virtualizedWindows.has(key)) {
    return Promise.resolve({ success: true, hwnd });
  }

  const pending = pendingVirtualAttaches.get(key);
  if (pending) {
    return pending;
  }

  const operation = performVirtualAttach(hwnd, key);
  pendingVirtualAttaches.set(key, operation);
  void operation.finally(() => {
    if (pendingVirtualAttaches.get(key) === operation) {
      pendingVirtualAttaches.delete(key);
    }
  });
  return operation;
}

async function performVirtualAttach(hwnd: string, key: string): Promise<EmbedResult> {

  const display = findVirtualDisplay();
  if (!display) {
    return {
      success: false,
      hwnd,
      error: 'InfiniteDesk virtual display is not active. Start the virtual-display host and try again.'
    };
  }

  console.info(
    `[virtual-display] Attaching ${hwnd} to display ${display.id} "${display.label}" ` +
      `at ${display.bounds.x},${display.bounds.y} ${display.bounds.width}x${display.bounds.height}.`
  );

  const result = await sendWindowControlCommand<VirtualAttachHostResult>('virtualAttach', {
    hwnd,
    displayX: display.bounds.x,
    displayY: display.bounds.y,
    displayWidth: display.bounds.width,
    displayHeight: display.bounds.height
  });

  if (!result.success || !result.originalPlacement) {
    return {
      success: false,
      hwnd,
      error: result.error || 'Could not move the window to the InfiniteDesk virtual display.'
    };
  }

  const previewResult = sendDwmPreviewCommand({ action: 'enable-real-input', hwnd });
  if (!previewResult.success) {
    await sendWindowControlCommand('virtualDetach', {
      hwnd,
      originalPlacement: result.originalPlacement
    });
    return {
      success: false,
      hwnd,
      error: previewResult.error || 'Could not enable real input for the mirrored window.'
    };
  }

  virtualizedWindows.set(key, {
    hwnd,
    originalPlacement: result.originalPlacement,
    displayId: display.id
  });
  return { success: true, hwnd };
}

export async function detachWindowFromVirtualDisplay(hwnd: string): Promise<EmbedResult> {
  const key = normalizedHwnd(hwnd);
  const pendingAttach = pendingVirtualAttaches.get(key);
  if (pendingAttach) {
    await pendingAttach;
  }
  const state = virtualizedWindows.get(key);
  if (!state) {
    return {
      success: false,
      hwnd,
      error: 'Window is not currently attached to the InfiniteDesk virtual display.'
    };
  }

  sendDwmPreviewCommand({ action: 'disable-real-input', hwnd });
  const result = await sendWindowControlCommand<EmbedResult>('virtualDetach', {
    hwnd,
    originalPlacement: state.originalPlacement
  });
  if (result.success) {
    virtualizedWindows.delete(key);
  }
  return result;
}

export function moveVirtualizedWindow(params: MoveEmbeddedWindowParams): EmbedResult {
  if (!hasVirtualizedWindow(params.hwnd)) {
    return {
      success: false,
      hwnd: params.hwnd,
      error: 'Window is not currently attached to the InfiniteDesk virtual display.'
    };
  }

  // Canvas pan and zoom only move the DWM preview. The real window remains at
  // a stable native size on the virtual monitor, avoiding SetParent reflow and
  // camera-induced shaking.
  return { success: true, hwnd: params.hwnd };
}

export async function detachAllVirtualizedWindows(): Promise<void> {
  for (const { hwnd } of Array.from(virtualizedWindows.values())) {
    try {
      await detachWindowFromVirtualDisplay(hwnd);
    } catch (error) {
      console.error(`[virtual-display:detach-all] ${hwnd}: ${(error as Error).message}`);
    }
  }
}
