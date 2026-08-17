import type { Dispatch, SetStateAction } from 'react';
import type { DwmPreviewWindow, MoveEmbeddedWindowParams, RelayPointerInput, WindowCommand } from '../../shared/types';
import type { VirtualWindowState } from '../canvas/types';

export type WindowControlActionsDeps = {
  embeddedWindowIds: string[];
  setEmbeddedWindowIds: Dispatch<SetStateAction<string[]>>;
  overlayModeEnabled: boolean;
  setOverlayModeEnabled: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setIsBrandMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export function useWindowControlActions(deps: WindowControlActionsDeps): {
  workInRealWindow: (hwnd: string) => Promise<void>;
  controlRealWindow: (hwnd: string, command: WindowCommand) => Promise<void>;
  embedRealWindow: (windowInfo: VirtualWindowState, bounds: MoveEmbeddedWindowParams) => Promise<void>;
  relayPointerInput: (input: RelayPointerInput) => Promise<void>;
  detachRealWindow: (hwnd: string) => Promise<void>;
  detachAllInteractiveWindows: () => Promise<boolean>;
  moveEmbeddedWindow: (params: MoveEmbeddedWindowParams) => Promise<void>;
  syncDwmPreviews: (previews: DwmPreviewWindow[]) => Promise<void>;
  clearDwmPreviews: () => Promise<void>;
  toggleOverlayMode: () => Promise<void>;
  quitInfiniteDesk: () => Promise<void>;
} {
  const { embeddedWindowIds, setEmbeddedWindowIds, overlayModeEnabled, setOverlayModeEnabled, setError, setMessage, setIsBrandMenuOpen } = deps;

  async function workInRealWindow(hwnd: string): Promise<void> {
    setError(null);
    try {
      const result = await window.infiniteDesk.workInWindow(hwnd);
      if (!result.success) {
        setError(result.error || 'Could not bring the real window forward.');
        return;
      }

      setMessage('Real window opened. InfiniteDesk was minimized so you can work in the app.');
    } catch (workError) {
      setError((workError as Error).message);
    }
  }

  async function controlRealWindow(hwnd: string, command: WindowCommand): Promise<void> {
    if (command === 'close') {
      const confirmed = window.confirm('Close this real Windows window? Unsaved work may prompt inside that app.');
      if (!confirmed) {
        return;
      }
    }

    setError(null);
    try {
      const result = await window.infiniteDesk.controlWindow(hwnd, command);
      if (!result.success) {
        setError(result.error || `Window command failed: ${command}.`);
        return;
      }

      setMessage(`Window command sent: ${command}.`);
    } catch (commandError) {
      setError((commandError as Error).message);
    }
  }

  async function embedRealWindow(windowInfo: VirtualWindowState, bounds: MoveEmbeddedWindowParams): Promise<void> {
    if (!windowInfo.hwnd) {
      return;
    }

    setError(null);
    try {
      const result = await window.infiniteDesk.embedWindowToHost({
        hwnd: windowInfo.hwnd,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      });

      if (!result.success) {
        setError(result.error || `Could not embed ${windowInfo.title}.`);
        return;
      }

      setEmbeddedWindowIds((current) => (current.includes(windowInfo.hwnd!) ? current : [...current, windowInfo.hwnd!]));
      setMessage(`Live input ready for "${windowInfo.title}". Click its preview to enter; Ctrl+Alt+F10 returns the cursor.`);
    } catch (embedError) {
      setError((embedError as Error).message);
    }
  }

  async function relayPointerInput(input: RelayPointerInput): Promise<void> {
    try {
      const result = await window.infiniteDesk.relayPointerInput(input);
      if (!result.success) {
        setError(result.error || 'Could not relay input to the original window.');
      }
    } catch (relayError) {
      setError((relayError as Error).message);
    }
  }

  async function detachRealWindow(hwnd: string): Promise<void> {
    setError(null);
    try {
      const result = await window.infiniteDesk.detachEmbeddedWindow(hwnd);
      if (!result.success) {
        setError(result.error || 'Could not detach embedded window.');
        return;
      }

      setEmbeddedWindowIds((current) => current.filter((item) => item !== hwnd));
      setMessage('Live input detached and the real window was restored.');
    } catch (detachError) {
      setError((detachError as Error).message);
    }
  }

  async function detachAllInteractiveWindows(): Promise<boolean> {
    if (embeddedWindowIds.length === 0) {
      setMessage('No interactive windows are attached.');
      return true;
    }

    setError(null);
    const failedHwnds: string[] = [];
    const failedMessages: string[] = [];
    for (const hwnd of embeddedWindowIds) {
      try {
        const result = await window.infiniteDesk.detachEmbeddedWindow(hwnd);
        if (!result.success) {
          failedHwnds.push(hwnd);
          failedMessages.push(result.error || hwnd);
        }
      } catch (detachError) {
        failedHwnds.push(hwnd);
        failedMessages.push((detachError as Error).message);
      }
    }

    if (failedHwnds.length > 0) {
      const failedSet = new Set(failedHwnds);
      setEmbeddedWindowIds((current) => current.filter((hwnd) => failedSet.has(hwnd)));
      setError(`Could not detach ${failedHwnds.length} interactive windows. ${failedMessages.join(' ')}`);
      return false;
    }

    setEmbeddedWindowIds([]);
    setMessage('Detached all interactive windows.');
    return true;
  }

  async function moveEmbeddedWindow(params: MoveEmbeddedWindowParams): Promise<void> {
    try {
      await window.infiniteDesk.moveEmbeddedWindow(params);
    } catch {
      // Embedded movement is best-effort during drag and zoom; explicit detach still reports errors.
    }
  }

  async function syncDwmPreviews(previews: DwmPreviewWindow[]): Promise<void> {
    try {
      await window.infiniteDesk.syncDwmPreviews(previews);
    } catch {
      // DWM previews are best-effort visual overlays. Window control still works without them.
    }
  }

  async function clearDwmPreviews(): Promise<void> {
    try {
      await window.infiniteDesk.clearDwmPreviews();
    } catch {
      // Ignore cleanup errors; the host is also stopped by the main process on quit.
    }
  }

  async function toggleOverlayMode(): Promise<void> {
    const nextEnabled = !overlayModeEnabled;

    if (nextEnabled) {
      const confirmed = window.confirm(
        'Native Overlay keeps InfiniteDesk above real windows as a translucent control layer. Turn it on?'
      );
      if (!confirmed) {
        return;
      }
    }

    setError(null);
    try {
      const result = await window.infiniteDesk.setOverlayMode(nextEnabled);
      if (!result.success) {
        setError(result.error || 'Could not change Native Overlay mode.');
        return;
      }

      setOverlayModeEnabled(result.enabled);
      setMessage(
        result.enabled
          ? 'Native Overlay enabled. InfiniteDesk is now layered over real windows.'
          : 'Native Overlay disabled. InfiniteDesk returned to normal controller mode.'
      );
    } catch (overlayError) {
      setError((overlayError as Error).message);
    } finally {
      setIsBrandMenuOpen(false);
    }
  }

  async function quitInfiniteDesk(): Promise<void> {
    setError(null);
    try {
      await window.infiniteDesk.quitApp();
    } catch (quitError) {
      setError((quitError as Error).message);
    }
  }

  return {
    workInRealWindow,
    controlRealWindow,
    embedRealWindow,
    relayPointerInput,
    detachRealWindow,
    detachAllInteractiveWindows,
    moveEmbeddedWindow,
    syncDwmPreviews,
    clearDwmPreviews,
    toggleOverlayMode,
    quitInfiniteDesk
  };
}
