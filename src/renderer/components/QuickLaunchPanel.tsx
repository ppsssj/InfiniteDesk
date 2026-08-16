import React from 'react';
import { X } from 'lucide-react';
import type { QuickLaunch } from '../../shared/types';

export type QuickLaunchPanelLayout = {
  side: 'left' | 'right';
  y: number;
  width: number;
  height: number;
};

type QuickLaunchPanelProps = {
  quickLaunches: QuickLaunch[];
  launchingAppId: string | null;
  previewSourceIds: Set<string>;
  layout: QuickLaunchPanelLayout;
  onLayoutChange: (layout: QuickLaunchPanelLayout) => void;
  onPreviewFrameChange: () => void;
  onLaunch: (quickLaunch: QuickLaunch) => void;
  onDelete: (quickLaunch: QuickLaunch) => void;
};

type PanelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PanelDragState =
  | {
      type: 'move';
      pointerId: number;
      startX: number;
      startY: number;
      initialRect: PanelRect;
    }
  | {
      type: 'resize';
      pointerId: number;
      startX: number;
      startY: number;
      initialRect: PanelRect;
    };

const PANEL_MARGIN = 12;
const MIN_PANEL_WIDTH = 220;
const MIN_PANEL_HEIGHT = 160;
const MAX_PANEL_WIDTH = 520;
const PANEL_SNAP_ANIMATION_MS = 220;

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'QL';
}

export function QuickLaunchPanel({
  quickLaunches,
  launchingAppId,
  previewSourceIds,
  layout,
  onLayoutChange,
  onPreviewFrameChange,
  onLaunch,
  onDelete
}: QuickLaunchPanelProps): React.JSX.Element | null {
  const panelRef = React.useRef<HTMLElement | null>(null);
  const dragStateRef = React.useRef<PanelDragState | null>(null);
  const previewFrameChangeRef = React.useRef(onPreviewFrameChange);
  const previewSyncAnimationFrameRef = React.useRef<number | null>(null);
  const previewSyncUntilRef = React.useRef(0);
  const [parentSize, setParentSize] = React.useState({ width: 0, height: 0 });
  const [transientRect, setTransientRect] = React.useState<PanelRect | null>(null);
  const [isInteracting, setIsInteracting] = React.useState(false);

  React.useEffect(() => {
    previewFrameChangeRef.current = onPreviewFrameChange;
  }, [onPreviewFrameChange]);

  React.useEffect(() => {
    return () => {
      if (previewSyncAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(previewSyncAnimationFrameRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) {
      return;
    }

    const updateParentSize = (): void => {
      setParentSize({
        width: parent.clientWidth,
        height: parent.clientHeight
      });
    };
    updateParentSize();
    const observer = new ResizeObserver(updateParentSize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    requestPreviewFrameChange();
  }, [layout, transientRect, parentSize]);

  if (quickLaunches.length === 0) {
    return null;
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  function requestPreviewFrameChange(): void {
    previewFrameChangeRef.current();
  }

  function syncPreviewDuringPanelAnimation(durationMs = PANEL_SNAP_ANIMATION_MS): void {
    previewSyncUntilRef.current = Math.max(previewSyncUntilRef.current, window.performance.now() + durationMs);
    if (previewSyncAnimationFrameRef.current !== null) {
      return;
    }

    const syncFrame = (): void => {
      requestPreviewFrameChange();
      if (window.performance.now() < previewSyncUntilRef.current) {
        previewSyncAnimationFrameRef.current = window.requestAnimationFrame(syncFrame);
        return;
      }

      previewSyncAnimationFrameRef.current = null;
    };

    previewSyncAnimationFrameRef.current = window.requestAnimationFrame(syncFrame);
  }

  function getMaxPanelWidth(): number {
    const parentWidth = parentSize.width || window.innerWidth;
    return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.floor(parentWidth * 0.45)));
  }

  function getMaxPanelHeight(): number {
    const parentHeight = parentSize.height || window.innerHeight;
    return Math.max(MIN_PANEL_HEIGHT, parentHeight - PANEL_MARGIN * 2);
  }

  function normalizeLayout(nextLayout: QuickLaunchPanelLayout): QuickLaunchPanelLayout {
    const width = Math.round(clamp(nextLayout.width, MIN_PANEL_WIDTH, getMaxPanelWidth()));
    const height = Math.round(clamp(nextLayout.height, MIN_PANEL_HEIGHT, getMaxPanelHeight()));
    const parentHeight = parentSize.height || window.innerHeight;
    return {
      ...nextLayout,
      width,
      height,
      y: Math.round(clamp(nextLayout.y, PANEL_MARGIN, Math.max(PANEL_MARGIN, parentHeight - height - PANEL_MARGIN)))
    };
  }

  function getSnappedRect(sourceLayout: QuickLaunchPanelLayout = layout): PanelRect {
    const normalized = normalizeLayout(sourceLayout);
    const parentWidth = parentSize.width || window.innerWidth;
    return {
      left: normalized.side === 'left' ? PANEL_MARGIN : Math.max(PANEL_MARGIN, parentWidth - normalized.width - PANEL_MARGIN),
      top: normalized.y,
      width: normalized.width,
      height: normalized.height
    };
  }

  function rectToLayout(rect: PanelRect): QuickLaunchPanelLayout {
    const parentWidth = parentSize.width || window.innerWidth;
    const side: QuickLaunchPanelLayout['side'] = rect.left + rect.width / 2 < parentWidth / 2 ? 'left' : 'right';
    return normalizeLayout({
      side,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  }

  function startMove(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }

    const rect = transientRect || getSnappedRect();
    dragStateRef.current = {
      type: 'move',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialRect: rect
    };
    setTransientRect(rect);
    setIsInteracting(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function startResize(event: React.PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) {
      return;
    }

    const rect = transientRect || getSnappedRect();
    dragStateRef.current = {
      type: 'resize',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialRect: rect
    };
    setTransientRect(rect);
    setIsInteracting(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const parentWidth = parentSize.width || window.innerWidth;
    const parentHeight = parentSize.height || window.innerHeight;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (dragState.type === 'move') {
      const nextRect = {
        ...dragState.initialRect,
        left: clamp(dragState.initialRect.left + deltaX, PANEL_MARGIN, Math.max(PANEL_MARGIN, parentWidth - dragState.initialRect.width - PANEL_MARGIN)),
        top: clamp(dragState.initialRect.top + deltaY, PANEL_MARGIN, Math.max(PANEL_MARGIN, parentHeight - dragState.initialRect.height - PANEL_MARGIN))
      };
      setTransientRect(nextRect);
      requestPreviewFrameChange();
      return;
    }

    const side = layout.side;
    const nextWidth = clamp(
      side === 'right' ? dragState.initialRect.width - deltaX : dragState.initialRect.width + deltaX,
      MIN_PANEL_WIDTH,
      getMaxPanelWidth()
    );
    const nextHeight = clamp(dragState.initialRect.height + deltaY, MIN_PANEL_HEIGHT, getMaxPanelHeight());
    const nextRect = {
      left: side === 'right' ? dragState.initialRect.left + dragState.initialRect.width - nextWidth : dragState.initialRect.left,
      top: clamp(dragState.initialRect.top, PANEL_MARGIN, Math.max(PANEL_MARGIN, parentHeight - nextHeight - PANEL_MARGIN)),
      width: nextWidth,
      height: nextHeight
    };
    setTransientRect(nextRect);
    requestPreviewFrameChange();
  }

  function finishInteraction(event: React.PointerEvent<HTMLElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const finalRect = transientRect || dragState.initialRect;
    dragStateRef.current = null;
    setTransientRect(null);
    setIsInteracting(false);
    onLayoutChange(rectToLayout(finalRect));
    syncPreviewDuringPanelAnimation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const snappedRect = getSnappedRect();
  const displayRect = transientRect || snappedRect;
  const panelStyle: React.CSSProperties = {
    left: displayRect.left,
    top: displayRect.top,
    width: displayRect.width,
    height: displayRect.height
  };
  const resizeTitle = layout.side === 'right' ? 'Resize from lower left' : 'Resize from lower right';

  return (
    <section
      ref={panelRef}
      className={`quick-launch-panel ${isInteracting ? 'interacting' : ''} side-${layout.side}`}
      data-dwm-ui-overlay="true"
      aria-label="Quick Launch"
      style={panelStyle}
      onPointerMove={handlePointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) {
          requestPreviewFrameChange();
        }
      }}
    >
      <div className="quick-launch-header" aria-label="Move Quick Launch panel" onPointerDown={startMove} />
      <div className="quick-launch-list">
        {quickLaunches.map((quickLaunch) => {
          const isLaunching = launchingAppId === quickLaunch.app.id;
          const hasPreview = previewSourceIds.has(quickLaunch.id);
          return (
            <div className="quick-launch-item" key={quickLaunch.id}>
              <div className="quick-launch-titlebar">
                <button
                  className="quick-launch-run"
                  type="button"
                  title={`${quickLaunch.name} at ${quickLaunch.x}, ${quickLaunch.y}`}
                  onClick={() => onLaunch(quickLaunch)}
                  disabled={isLaunching}
                >
                  {quickLaunch.app.iconDataUrl ? (
                    <img src={quickLaunch.app.iconDataUrl} alt="" />
                  ) : (
                    <span>{quickLaunch.app.icon || getInitials(quickLaunch.name)}</span>
                  )}
                  <strong>{quickLaunch.name}</strong>
                </button>
                <button
                  className="quick-launch-delete"
                  type="button"
                  title={`Remove ${quickLaunch.name}`}
                  aria-label={`Remove ${quickLaunch.name}`}
                  onClick={() => onDelete(quickLaunch)}
                >
                  <X size={12} />
                </button>
              </div>
              <div className="quick-launch-preview" data-dwm-preview-id={quickLaunch.id}>
                {hasPreview ? null : <span>No live window</span>}
              </div>
            </div>
          );
        })}
      </div>
      <button className="quick-launch-resize-handle" type="button" title={resizeTitle} aria-label={resizeTitle} onPointerDown={startResize} />
    </section>
  );
}
