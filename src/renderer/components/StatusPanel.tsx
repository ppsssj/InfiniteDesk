import React from 'react';

type StatusPanelProps = {
  message: string;
  restorableCount: number;
  regionsCount: number;
  dirtyCount: number;
  workspacesCount: number;
  templatesCount: number;
  overlayModeEnabled: boolean;
};

export function StatusPanel({
  message,
  restorableCount,
  regionsCount,
  dirtyCount,
  workspacesCount,
  templatesCount,
  overlayModeEnabled
}: StatusPanelProps): React.JSX.Element {
  return (
    <section className="side-section status-panel">
      <h2>Status</h2>
      <p>{message}</p>
      <p>
        {restorableCount} restorable windows - {regionsCount} regions - {dirtyCount} edits
      </p>
      <p>
        {workspacesCount} saved workspaces - {templatesCount} saved templates
      </p>
      <p>
        Native Overlay is {overlayModeEnabled ? 'On: InfiniteDesk is layered over real windows.' : 'Off: InfiniteDesk is a normal controller window.'}
      </p>
      <p>
        Mirror Control is always on. Original app windows remain unchanged.
      </p>
      <div className="shortcut-list">
        <strong>Workflow</strong>
        <span>Native Overlay makes InfiniteDesk a translucent layer above real windows.</span>
        <span>Mirror Control relays clicks, drags, right-clicks, scrolling, and focus while live views remain inside InfiniteDesk.</span>
        <span>Select a region, then launch apps from the Dock to place them there.</span>
        <span>Ctrl+Drag on empty canvas creates a Template Region.</span>
        <span>Drag a region to move its assigned windows together.</span>
        <span>Click a live preview, then type normally; keyboard input follows the focused original app.</span>
        <span>Use window frame controls to focus, minimize, maximize, restore, or close real windows.</span>
      </div>
      <div className="shortcut-list">
        <strong>Shortcuts</strong>
        <span>Ctrl+R Scan Windows</span>
        <span>Ctrl+S Save Regions</span>
        <span>Ctrl+Enter Apply Layout</span>
        <span>Ctrl+0 Fit View</span>
        <span>Ctrl+Shift+O Native Overlay</span>
        <span>Esc Close overlays</span>
      </div>
    </section>
  );
}
