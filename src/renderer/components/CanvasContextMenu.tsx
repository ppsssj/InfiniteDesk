import React from 'react';
import type { VirtualWindowState } from '../canvas/types';
import type { DockApp } from '../../shared/types';
import type { ContextMenuState } from './CanvasPreview.types';

type CanvasContextMenuProps = {
  contextMenu: ContextMenuState;
  contextWindow: VirtualWindowState | null;
  canvasLaunchApps: DockApp[];
  onClose: () => void;
  onScanWindows: () => void;
  onFitView: () => void;
  onResetView: () => void;
  onLaunchAppAt: (app: DockApp, point: { x: number; y: number }) => void;
  onZoomToWindow: (windowInfo: VirtualWindowState) => void;
  onWorkInWindow: (windowInfo: VirtualWindowState) => void;
  onPinToQuickLaunch: (windowInfo: VirtualWindowState) => void;
  onCloseWindow: (windowInfo: VirtualWindowState) => void;
  onRemoveWindowFromCanvas: (key: string) => void;
};

export function CanvasContextMenu({
  contextMenu,
  contextWindow,
  canvasLaunchApps,
  onClose,
  onScanWindows,
  onFitView,
  onResetView,
  onLaunchAppAt,
  onZoomToWindow,
  onWorkInWindow,
  onPinToQuickLaunch,
  onCloseWindow,
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
          {canvasLaunchApps.length > 0 ? (
            <>
              {canvasLaunchApps.map((app) => (
                <button key={app.id} onClick={() => closeThen(() => onLaunchAppAt(app, { x: contextMenu.worldX, y: contextMenu.worldY }))}>
                  Open {app.name} Here
                </button>
              ))}
              <div className="context-menu-separator" />
            </>
          ) : null}
          <button onClick={() => closeThen(onScanWindows)}>Scan Windows</button>
          <button onClick={() => closeThen(onFitView)}>Fit View</button>
          <button onClick={() => closeThen(onResetView)}>Reset View</button>
        </>
      ) : null}

      {contextMenu.type === 'window' && contextWindow ? (
        <>
          {contextWindow.hwnd ? (
            <>
              <button onClick={() => closeThen(() => onZoomToWindow(contextWindow))}>Zoom to Window</button>
              <button onClick={() => closeThen(() => onWorkInWindow(contextWindow))}>Open Real Window</button>
              <button onClick={() => closeThen(() => onPinToQuickLaunch(contextWindow))}>Pin to Quick Launch</button>
              <div className="context-menu-separator" />
            </>
          ) : null}
          <button onClick={() => closeThen(() => onRemoveWindowFromCanvas(contextMenu.key))}>Remove from Canvas</button>
          {contextWindow.hwnd ? (
            <button className="danger-menu-action" onClick={() => closeThen(() => onCloseWindow(contextWindow))}>
              Close Window
            </button>
          ) : null}
        </>
      ) : null}

    </div>
  );
}
