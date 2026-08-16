import React from 'react';

type StatusPanelProps = {
  message: string;
  restorableCount: number;
  dirtyCount: number;
  workspacesCount: number;
  overlayModeEnabled: boolean;
  applyDisabled: boolean;
  resetDisabled: boolean;
  onSaveWorkspace: () => void;
  onApplyLayout: () => void;
  onResetEdits: () => void;
  onToggleOverlay: () => void;
};

export function StatusPanel({
  message,
  restorableCount,
  dirtyCount,
  workspacesCount,
  overlayModeEnabled,
  applyDisabled,
  resetDisabled,
  onSaveWorkspace,
  onApplyLayout,
  onResetEdits,
  onToggleOverlay
}: StatusPanelProps): React.JSX.Element {
  return (
    <section className="side-section status-panel">
      <h2>Status</h2>
      <p>{message}</p>
      <p>
        {restorableCount} restorable windows - {dirtyCount} edits
      </p>
      <p>
        {workspacesCount} saved workspaces
      </p>
      <p>
        Native Overlay is {overlayModeEnabled ? 'On: InfiniteDesk is layered over real windows.' : 'Off: InfiniteDesk is a normal controller window.'}
      </p>
      <p>
        Mirror Control is always on. Original app windows remain unchanged.
      </p>
      <div className="details-action-grid">
        <button type="button" onClick={onSaveWorkspace}>Save Workspace</button>
        <button type="button" onClick={onApplyLayout} disabled={applyDisabled}>Apply Layout</button>
        <button type="button" onClick={onResetEdits} disabled={resetDisabled}>Reset Edits</button>
        <button type="button" onClick={onToggleOverlay}>Native Overlay {overlayModeEnabled ? 'Off' : 'On'}</button>
      </div>
      <div className="shortcut-list">
        <strong>Workflow</strong>
        <span>Native Overlay makes InfiniteDesk a translucent layer above real windows.</span>
        <span>Mirror Control relays clicks, drags, right-clicks, scrolling, and focus while live views remain inside InfiniteDesk.</span>
        <span>Drag window cards on the canvas, then apply the layout to the real windows.</span>
        <span>Click a live preview, then type normally; keyboard input follows the focused original app.</span>
        <span>Use window frame controls to focus, minimize, maximize, restore, or close real windows.</span>
      </div>
      <div className="shortcut-list">
        <strong>Shortcuts</strong>
        <span>Ctrl+R - Scan Windows</span>
        <span>Ctrl+S / Ctrl+Shift+S - Save Workspace</span>
        <span>Ctrl+Z - Undo canvas edit</span>
        <span>Ctrl+Shift+Z / Ctrl+Y - Redo canvas edit</span>
        <span>F or Ctrl+0 - Fit View</span>
        <span>1 - Actual Size</span>
        <span>+ / - - Zoom in or out</span>
        <span>Space+Drag - Pan canvas</span>
        <span>Ctrl+Drag - Select windows</span>
        <span>Ctrl+A - Select all windows</span>
        <span>Delete / Backspace - Remove selected windows from canvas</span>
        <span>Enter - Focus selected real window</span>
        <span>Ctrl+Enter - Zoom to selected window</span>
        <span>Ctrl+E - Attach or detach interactive control</span>
        <span>Alt+Arrow - Move selected windows 10px</span>
        <span>Alt+Shift+Arrow - Move selected windows 50px</span>
        <span>Ctrl+Shift+O - Toggle Native Overlay</span>
        <span>Esc - Close overlays</span>
      </div>
    </section>
  );
}
