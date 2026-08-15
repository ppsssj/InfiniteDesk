import React from 'react';
import type { VirtualWindowState } from '../canvas/types';
import type { WindowCommand } from '../../shared/types';
import type { ContextMenuState } from './CanvasPreview.types';

type CanvasContextMenuProps = {
  contextMenu: ContextMenuState;
  contextWindow: VirtualWindowState | null;
  onClose: () => void;
  onScanWindows: () => void;
  onFitView: () => void;
  onResetView: () => void;
  onZoomToWindow: (windowInfo: VirtualWindowState) => void;
  onWorkInWindow: (windowInfo: VirtualWindowState) => void;
  onRunWindowCommand: (windowInfo: VirtualWindowState, command: WindowCommand) => void;
  onApplyWindow: (windowInfo: VirtualWindowState) => void;
  onResetWindowPosition: (key: string) => void;
  onRemoveWindowFromCanvas: (key: string) => void;
};

export function CanvasContextMenu({
  contextMenu,
  contextWindow,
  onClose,
  onScanWindows,
  onFitView,
  onResetView,
  onZoomToWindow,
  onWorkInWindow,
  onRunWindowCommand,
  onApplyWindow,
  onResetWindowPosition,
  onRemoveWindowFromCanvas
}: CanvasContextMenuProps): React.JSX.Element {
  function closeThen(action: () => void): void {
    onClose();
    action();
  }

  return (
    <div className="context-menu" data-dwm-ui-overlay="true" style={{ left: contextMenu.screenX, top: contextMenu.screenY }}>
      {contextMenu.type === 'canvas' ? (
        <>
          <button onClick={() => closeThen(onScanWindows)}>Scan Windows</button>
          <button onClick={() => closeThen(onFitView)}>Fit View</button>
          <button onClick={() => closeThen(onResetView)}>Reset View</button>
        </>
      ) : null}

      {contextMenu.type === 'window' && contextWindow ? (
        <>
          {contextWindow.hwnd ? (
            <>
              <button onClick={() => closeThen(() => onZoomToWindow(contextWindow))}>Zoom Mirror Control</button>
              <button onClick={() => closeThen(() => onWorkInWindow(contextWindow))}>Work in Real Window</button>
              <button onClick={() => closeThen(() => onRunWindowCommand(contextWindow, 'focus'))}>Focus Real Window</button>
              <button onClick={() => closeThen(() => onRunWindowCommand(contextWindow, 'minimize'))}>Minimize Real Window</button>
              <button onClick={() => closeThen(() => onRunWindowCommand(contextWindow, 'maximize'))}>Maximize Real Window</button>
              <button onClick={() => closeThen(() => onRunWindowCommand(contextWindow, 'restore'))}>Restore Real Window</button>
            </>
          ) : null}
          <button onClick={() => closeThen(() => onApplyWindow(contextWindow))}>Apply This Window</button>
          <button onClick={() => closeThen(() => onResetWindowPosition(contextMenu.key))}>Reset Window Position</button>
          <button onClick={() => closeThen(() => onRemoveWindowFromCanvas(contextMenu.key))}>Remove from Canvas</button>
          {contextWindow.hwnd ? (
            <button onClick={() => closeThen(() => onRunWindowCommand(contextWindow, 'close'))}>Close Real Window</button>
          ) : null}
        </>
      ) : null}

    </div>
  );
}
