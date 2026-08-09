import React from 'react';
import type { TemplateRegion, VirtualWindowState } from '../canvas/types';
import type { WindowCommand } from '../../shared/types';
import type { ContextMenuState } from './CanvasPreview.types';

type CanvasContextMenuProps = {
  contextMenu: ContextMenuState;
  contextWindow: VirtualWindowState | null;
  contextRegion: TemplateRegion | null;
  onClose: () => void;
  onScanWindows: () => void;
  onCreateRegionHere: (worldX: number, worldY: number) => void;
  onSaveRegions: () => void;
  onFitView: () => void;
  onResetView: () => void;
  onZoomToWindow: (windowInfo: VirtualWindowState) => void;
  onWorkInWindow: (windowInfo: VirtualWindowState) => void;
  onRunWindowCommand: (windowInfo: VirtualWindowState, command: WindowCommand) => void;
  onApplyWindow: (windowInfo: VirtualWindowState) => void;
  onResetWindowPosition: (key: string) => void;
  onRemoveWindowFromCanvas: (key: string) => void;
  onRenameRegion: (region: TemplateRegion) => void;
  onSaveRegion: (region: TemplateRegion) => void;
  onApplyRegion: (region: TemplateRegion) => void;
  onDeleteRegion: (id: string) => void;
};

export function CanvasContextMenu({
  contextMenu,
  contextWindow,
  contextRegion,
  onClose,
  onScanWindows,
  onCreateRegionHere,
  onSaveRegions,
  onFitView,
  onResetView,
  onZoomToWindow,
  onWorkInWindow,
  onRunWindowCommand,
  onApplyWindow,
  onResetWindowPosition,
  onRemoveWindowFromCanvas,
  onRenameRegion,
  onSaveRegion,
  onApplyRegion,
  onDeleteRegion
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
          <button onClick={() => closeThen(() => onCreateRegionHere(contextMenu.worldX, contextMenu.worldY))}>Create Region Here</button>
          <button onClick={() => closeThen(onSaveRegions)}>Save Regions</button>
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

      {contextMenu.type === 'region' && contextRegion ? (
        <>
          <button onClick={() => closeThen(() => onRenameRegion(contextRegion))}>Rename Region</button>
          <button onClick={() => closeThen(() => onSaveRegion(contextRegion))}>Save This Region</button>
          <button onClick={() => closeThen(() => onApplyRegion(contextRegion))}>Apply Region</button>
          <button onClick={() => closeThen(() => onDeleteRegion(contextRegion.id))}>Delete Region</button>
        </>
      ) : null}
    </div>
  );
}
