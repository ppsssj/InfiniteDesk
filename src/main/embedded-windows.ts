import type { EmbedResult, EmbedWindowParams, MoveEmbeddedWindowParams } from '../shared/types';
import { sendWindowControlCommand } from './window-control-client';

const embeddedWindows = new Map<string, Required<Pick<EmbedResult, 'originalParentHwnd' | 'originalStyle' | 'originalExStyle' | 'originalX' | 'originalY' | 'originalWidth' | 'originalHeight'>>>();
const embeddedMoveQueue = new Map<string, { inFlight: boolean; latest: MoveEmbeddedWindowParams | null }>();

export function normalizeEmbedBounds(params: Pick<EmbedWindowParams, 'x' | 'y' | 'width' | 'height'>): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(params.x),
    y: Math.round(params.y),
    width: Math.max(80, Math.round(params.width)),
    height: Math.max(60, Math.round(params.height))
  };
}

export function recordEmbeddedWindow(hwnd: string, original: Required<Pick<EmbedResult, 'originalParentHwnd' | 'originalStyle' | 'originalExStyle' | 'originalX' | 'originalY' | 'originalWidth' | 'originalHeight'>>): void {
  embeddedWindows.set(hwnd, original);
}

export function hasEmbeddedWindow(hwnd: string): boolean {
  return embeddedWindows.has(hwnd);
}

export function getEmbeddedWindowCount(): number {
  return embeddedWindows.size;
}

function runEmbeddedMove(params: MoveEmbeddedWindowParams): Promise<EmbedResult> {
  return sendWindowControlCommand<EmbedResult>('moveEmbedded', {
    hwnd: params.hwnd,
    ...normalizeEmbedBounds(params)
  });
}

async function drainEmbeddedMoveQueue(hwnd: string, firstMove: MoveEmbeddedWindowParams): Promise<void> {
  let currentMove: MoveEmbeddedWindowParams | null = firstMove;

  while (currentMove) {
    try {
      await runEmbeddedMove(currentMove);
    } catch (error) {
      console.error(`[embed:move] ${hwnd}: ${(error as Error).message}`);
    }

    const state = embeddedMoveQueue.get(hwnd);
    currentMove = state?.latest || null;
    if (state) {
      state.latest = null;
    }
  }

  embeddedMoveQueue.delete(hwnd);
}

export function queueEmbeddedMove(params: MoveEmbeddedWindowParams): EmbedResult {
  const existing = embeddedMoveQueue.get(params.hwnd);

  if (existing?.inFlight) {
    existing.latest = params;
    return {
      success: true,
      hwnd: params.hwnd
    };
  }

  embeddedMoveQueue.set(params.hwnd, {
    inFlight: true,
    latest: null
  });

  void drainEmbeddedMoveQueue(params.hwnd, params);

  return {
    success: true,
    hwnd: params.hwnd
  };
}

export async function detachEmbeddedWindow(hwnd: string): Promise<EmbedResult> {
  const original = embeddedWindows.get(hwnd);
  if (!original) {
    return {
      success: false,
      hwnd,
      error: 'Window is not currently embedded by InfiniteDesk.'
    };
  }

  const result = await sendWindowControlCommand<EmbedResult>('detach', {
    hwnd,
    originalParentHwnd: original.originalParentHwnd,
    originalStyle: original.originalStyle,
    originalExStyle: original.originalExStyle,
    originalX: original.originalX,
    originalY: original.originalY,
    originalWidth: original.originalWidth,
    originalHeight: original.originalHeight
  });

  if (result.success) {
    embeddedWindows.delete(hwnd);
    embeddedMoveQueue.delete(hwnd);
  }

  return result;
}

export async function detachAllEmbeddedWindows(): Promise<void> {
  const hwnds = Array.from(embeddedWindows.keys());
  for (const hwnd of hwnds) {
    try {
      await detachEmbeddedWindow(hwnd);
    } catch (error) {
      console.error(`[embed:detach-all] ${hwnd}: ${(error as Error).message}`);
    }
  }
}
