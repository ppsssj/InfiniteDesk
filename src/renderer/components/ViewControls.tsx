import React from 'react';
import { Minus, Plus } from 'lucide-react';

type ViewControlsProps = {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  zoomScale: number;
  isDrawerOpen: boolean;
  onToggleDrawer: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onActualSize: () => void;
  onFit: () => void;
};

export function ViewControls({
  isExpanded,
  onExpandedChange,
  zoomScale,
  isDrawerOpen,
  onToggleDrawer,
  onZoomIn,
  onZoomOut,
  onActualSize,
  onFit
}: ViewControlsProps): React.JSX.Element {
  return (
    <div
      className={`floating-view-controls ${isExpanded ? 'expanded' : ''}`}
      data-dwm-ui-overlay="true"
      onMouseEnter={() => onExpandedChange(true)}
      onMouseLeave={() => onExpandedChange(false)}
      onFocusCapture={() => onExpandedChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onExpandedChange(false);
        }
      }}
    >
      <button className="view-controls-toggle" title="View controls" onClick={() => onExpandedChange(!isExpanded)}>
        {Math.round(zoomScale * 100)}%
      </button>
      <button className="view-control-detail" title="Zoom out" onClick={onZoomOut}>
        <Minus size={15} />
      </button>
      <button className="view-control-detail" title="Zoom in" onClick={onZoomIn}>
        <Plus size={15} />
      </button>
      <button className="view-control-detail" title="Actual size (sharpest)" onClick={onActualSize}>1:1</button>
      <button className="view-control-detail" onClick={onFit}>Fit</button>
      <button className="view-control-detail" onClick={onToggleDrawer}>{isDrawerOpen ? 'Close' : 'Details'}</button>
    </div>
  );
}
