import type { RefObject } from 'react';
import type React from 'react';
import type { VirtualWindowState } from '../canvas/types';
import type { RelayPointerInput } from '../../shared/types';

export type UseMirrorPointerRelayParams = {
  canvasRef: RefObject<HTMLDivElement | null>;
  getOverviewContentScreenBounds: (windowInfo: VirtualWindowState) => { x: number; y: number; width: number; height: number };
  onRelayPointerInput: (input: RelayPointerInput) => void;
};

export function useMirrorPointerRelay({
  canvasRef,
  getOverviewContentScreenBounds,
  onRelayPointerInput
}: UseMirrorPointerRelayParams): {
  relayMirrorPointer: (
    event: React.PointerEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>,
    windowInfo: VirtualWindowState,
    action: RelayPointerInput['action']
  ) => void;
  handleMirrorPointerDown: (event: React.PointerEvent<HTMLDivElement>, windowInfo: VirtualWindowState) => void;
  handleMirrorPointerUp: (event: React.PointerEvent<HTMLDivElement>, windowInfo: VirtualWindowState) => void;
  handleMirrorPointerCancel: (event: React.PointerEvent<HTMLDivElement>, windowInfo: VirtualWindowState) => void;
} {
  function relayMirrorPointer(
    event: React.PointerEvent<HTMLDivElement> | React.WheelEvent<HTMLDivElement>,
    windowInfo: VirtualWindowState,
    action: RelayPointerInput['action']
  ): void {
    if (!windowInfo.hwnd) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const canvasRect = canvas.getBoundingClientRect();
    const previewBounds = getOverviewContentScreenBounds(windowInfo);
    const pointerX = event.clientX - canvasRect.left;
    const pointerY = event.clientY - canvasRect.top;
    const normalizedX = Math.min(1, Math.max(0, (pointerX - previewBounds.x) / Math.max(1, previewBounds.width)));
    const normalizedY = Math.min(1, Math.max(0, (pointerY - previewBounds.y) / Math.max(1, previewBounds.height)));
    const pointerButton =
      'button' in event ? (event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left') : 'left';

    onRelayPointerInput({
      hwnd: windowInfo.hwnd,
      normalizedX,
      normalizedY,
      action,
      button: pointerButton,
      buttons: 'buttons' in event ? event.buttons : 0,
      wheelDelta: action === 'wheel' && 'deltaY' in event ? Math.round(-event.deltaY) : undefined
    });
  }

  function handleMirrorPointerDown(event: React.PointerEvent<HTMLDivElement>, windowInfo: VirtualWindowState): void {
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    relayMirrorPointer(event, windowInfo, 'down');
  }

  function handleMirrorPointerUp(event: React.PointerEvent<HTMLDivElement>, windowInfo: VirtualWindowState): void {
    relayMirrorPointer(event, windowInfo, 'up');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleMirrorPointerCancel(event: React.PointerEvent<HTMLDivElement>, windowInfo: VirtualWindowState): void {
    relayMirrorPointer(event, windowInfo, 'cancel');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return { relayMirrorPointer, handleMirrorPointerDown, handleMirrorPointerUp, handleMirrorPointerCancel };
}
