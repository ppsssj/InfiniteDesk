import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Focus, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import { fitViewToWindows, clampScale, screenToWorld, worldToScreen, type CanvasTransform } from '../canvas/transform';
import { getWindowIdentity, updateRegionMembership } from '../canvas/regions';
import { getVirtualWindowBounds } from '../canvas/windows';
import type { DwmPreviewWindow, MoveEmbeddedWindowParams, WindowCommand } from '../../shared/types';
import type { TemplateRegion, VirtualWindowState } from '../canvas/types';

type CanvasPreviewProps = {
  windows: VirtualWindowState[];
  regions: TemplateRegion[];
  previewLabel: string;
  selectedRegionId: string | null;
  liveControlEnabled: boolean;
  experimentalEmbedEnabled: boolean;
  embeddedWindowIds: string[];
  onWindowsChange: (windows: VirtualWindowState[]) => void;
  onRegionsChange: (regions: TemplateRegion[]) => void;
  onSelectRegion: (regionId: string | null) => void;
  onLiveMoveWindow: (windowInfo: VirtualWindowState) => void;
  onWorkWindow: (hwnd: string) => void;
  onWindowCommand: (hwnd: string, command: WindowCommand) => void;
  onEmbedWindow: (windowInfo: VirtualWindowState, bounds: MoveEmbeddedWindowParams) => void;
  onDetachEmbeddedWindow: (hwnd: string) => void;
  onMoveEmbeddedWindow: (params: MoveEmbeddedWindowParams) => void;
  onSyncDwmPreviews: (previews: DwmPreviewWindow[]) => void;
  onClearDwmPreviews: () => void;
  onScanWindows: () => void;
  onSaveRegions: () => void;
  onApplyWindows: (windows: VirtualWindowState[]) => void;
  onSaveRegion: (region: TemplateRegion) => void;
  fitSignal: number;
  resetViewSignal: number;
  zoomInSignal: number;
  zoomOutSignal: number;
  onZoomChange: (scale: number) => void;
};

const DEFAULT_TRANSFORM: CanvasTransform = {
  offsetX: 120,
  offsetY: 96,
  scale: 0.2
};
const MIN_REGION_WIDTH = 200;
const MIN_REGION_HEIGHT = 140;
const DEFAULT_REGION_WIDTH = 420;
const DEFAULT_REGION_HEIGHT = 280;
const REGION_COLORS = ['#2f7666', '#8a3f2f', '#6f5520', '#4d6793', '#7a5b8f'];
const LIVE_MOVE_THROTTLE_MS = 40;
const EMBEDDED_MOVE_THROTTLE_MS = 50;
const EMBEDDED_NODE_CHROME_WIDTH = 16;
const EMBEDDED_NODE_CHROME_HEIGHT = 54;
const EMBEDDED_NODE_CONTENT_INSET_X = 8;
const EMBEDDED_NODE_CONTENT_INSET_TOP = 46;
const EMBEDDED_NODE_CONTENT_INSET_BOTTOM = 8;
const NATIVE_EMBEDDED_VISIBLE_SCALE = 0.65;
const HIDDEN_EMBEDDED_WINDOW_X = -30000;
const HIDDEN_EMBEDDED_WINDOW_Y = -30000;
const DWM_PREVIEW_SYNC_DELAY_MS = 50;

type PanDrag = {
  type: 'pan';
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
};

type CreateRegionDrag = {
  type: 'create-region';
  startWorldX: number;
  startWorldY: number;
};

type WindowDrag = {
  type: 'window';
  key: string;
  startX: number;
  startY: number;
  virtualX: number;
  virtualY: number;
  moved: boolean;
};

type RegionDrag = {
  type: 'region';
  id: string;
  startX: number;
  startY: number;
  regionX: number;
  regionY: number;
  windowPositions: Array<{ id: string; virtualX: number; virtualY: number }>;
};

type ContextMenuState =
  | { type: 'canvas'; screenX: number; screenY: number; worldX: number; worldY: number }
  | { type: 'window'; screenX: number; screenY: number; key: string }
  | { type: 'region'; screenX: number; screenY: number; id: string };

function getWindowKey(windowInfo: VirtualWindowState, index: number): string {
  return windowInfo.hwnd || `${windowInfo.processName}-${windowInfo.title}-${index}`;
}

function normalizeDraftRegion(region: TemplateRegion): TemplateRegion {
  const x = region.width < 0 ? region.x + region.width : region.x;
  const y = region.height < 0 ? region.y + region.height : region.y;

  return {
    ...region,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.abs(region.width)),
    height: Math.round(Math.abs(region.height))
  };
}

function getPlaceholderKind(processName: string): 'code' | 'browser' | 'explorer' | 'terminal' | 'generic' {
  const normalized = processName.toLowerCase();
  if (normalized.includes('code')) {
    return 'code';
  }
  if (normalized.includes('chrome') || normalized.includes('edge') || normalized.includes('msedge')) {
    return 'browser';
  }
  if (normalized.includes('explorer')) {
    return 'explorer';
  }
  if (normalized.includes('terminal') || normalized.includes('wt') || normalized.includes('powershell') || normalized.includes('cmd')) {
    return 'terminal';
  }
  return 'generic';
}

function WindowPlaceholder({ processName }: { processName: string }): React.JSX.Element {
  const kind = getPlaceholderKind(processName);
  return (
    <div className={`window-placeholder placeholder-${kind}`}>
      {kind === 'code' ? (
        <>
          <div className="placeholder-sidebar" />
          <div className="placeholder-lines">
            <i />
            <i />
            <i />
            <i />
          </div>
        </>
      ) : null}
      {kind === 'browser' ? (
        <>
          <div className="placeholder-address" />
          <div className="placeholder-cards">
            <i />
            <i />
            <i />
          </div>
        </>
      ) : null}
      {kind === 'explorer' ? (
        <div className="placeholder-folder-list">
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {kind === 'terminal' ? (
        <div className="placeholder-terminal-lines">
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : null}
      {kind === 'generic' ? (
        <div className="placeholder-generic">
          <i />
          <i />
        </div>
      ) : null}
    </div>
  );
}

export function CanvasPreview({
  windows,
  regions,
  previewLabel,
  selectedRegionId,
  liveControlEnabled,
  experimentalEmbedEnabled,
  embeddedWindowIds,
  onWindowsChange,
  onRegionsChange,
  onSelectRegion,
  onLiveMoveWindow,
  onWorkWindow,
  onWindowCommand,
  onEmbedWindow,
  onDetachEmbeddedWindow,
  onMoveEmbeddedWindow,
  onSyncDwmPreviews,
  onClearDwmPreviews,
  onScanWindows,
  onSaveRegions,
  onApplyWindows,
  onSaveRegion,
  fitSignal,
  resetViewSignal,
  zoomInSignal,
  zoomOutSignal,
  onZoomChange
}: CanvasPreviewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<PanDrag | CreateRegionDrag | WindowDrag | RegionDrag | null>(null);
  const windowsRef = useRef(windows);
  const regionsRef = useRef(regions);
  const liveMoveRef = useRef<Record<string, { lastMoveAt: number; timeoutId: number | null }>>({});
  const embeddedMoveRef = useRef<Record<string, { lastMoveAt: number; timeoutId: number | null; latest: MoveEmbeddedWindowParams | null }>>({});
  const [transform, setTransformState] = useState<CanvasTransform>(DEFAULT_TRANSFORM);
  const [dragMode, setDragMode] = useState<'none' | 'pan' | 'window' | 'region' | 'create-region'>('none');
  const [draftRegion, setDraftRegion] = useState<TemplateRegion | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const bounds = useMemo(() => getVirtualWindowBounds(windows), [windows]);
  const embeddedWindowIdSet = useMemo(() => new Set(embeddedWindowIds), [embeddedWindowIds]);

  function setTransform(next: CanvasTransform | ((current: CanvasTransform) => CanvasTransform)): void {
    setTransformState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      return resolved;
    });
  }

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  useEffect(() => {
    onZoomChange(transform.scale);
  }, [onZoomChange, transform.scale]);

  useEffect(() => {
    return () => {
      Object.values(liveMoveRef.current).forEach((item) => {
        if (item.timeoutId !== null) {
          window.clearTimeout(item.timeoutId);
        }
      });
      Object.values(embeddedMoveRef.current).forEach((item) => {
        if (item.timeoutId !== null) {
          window.clearTimeout(item.timeoutId);
        }
      });
    };
  }, []);

  useEffect(() => {
    let animationFrameId = 0;
    function handleResize(): void {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(() => {
        setViewportVersion((value) => value + 1);
      });
    }

    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  function scheduleLiveMove(windowInfo: VirtualWindowState): void {
    if (!liveControlEnabled || !windowInfo.hwnd) {
      return;
    }

    const key = windowInfo.hwnd;
    const now = window.performance.now();
    const existing = liveMoveRef.current[key] || { lastMoveAt: 0, timeoutId: null };
    const elapsed = now - existing.lastMoveAt;

    if (elapsed >= LIVE_MOVE_THROTTLE_MS) {
      if (existing.timeoutId !== null) {
        window.clearTimeout(existing.timeoutId);
      }
      liveMoveRef.current[key] = {
        lastMoveAt: now,
        timeoutId: null
      };
      onLiveMoveWindow(windowInfo);
      return;
    }

    if (existing.timeoutId !== null) {
      window.clearTimeout(existing.timeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      liveMoveRef.current[key] = {
        lastMoveAt: window.performance.now(),
        timeoutId: null
      };
      onLiveMoveWindow(windowInfo);
    }, LIVE_MOVE_THROTTLE_MS - elapsed);

    liveMoveRef.current[key] = {
      ...existing,
      timeoutId
    };
  }

  function scheduleEmbeddedMove(params: MoveEmbeddedWindowParams, immediate = false): void {
    if (!params.hwnd || (!experimentalEmbedEnabled && !embeddedWindowIdSet.has(params.hwnd))) {
      return;
    }

    const key = params.hwnd;
    const now = window.performance.now();
    const existing = embeddedMoveRef.current[key] || { lastMoveAt: 0, timeoutId: null, latest: null };
    const elapsed = now - existing.lastMoveAt;

    if (immediate || elapsed >= EMBEDDED_MOVE_THROTTLE_MS) {
      if (existing.timeoutId !== null) {
        window.clearTimeout(existing.timeoutId);
      }
      embeddedMoveRef.current[key] = {
        lastMoveAt: now,
        timeoutId: null,
        latest: params
      };
      onMoveEmbeddedWindow(params);
      return;
    }

    if (existing.timeoutId !== null) {
      window.clearTimeout(existing.timeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      const latest = embeddedMoveRef.current[key]?.latest || params;
      embeddedMoveRef.current[key] = {
        lastMoveAt: window.performance.now(),
        timeoutId: null,
        latest
      };
      onMoveEmbeddedWindow(latest);
    }, EMBEDDED_MOVE_THROTTLE_MS - elapsed);

    embeddedMoveRef.current[key] = {
      ...existing,
      timeoutId,
      latest: params
    };
  }

  function fitView(): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      setTransform(DEFAULT_TRANSFORM);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    setTransform(fitViewToWindows(windows, rect.width, rect.height));
  }

  function zoomBy(multiplier: number): void {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = rect.width / 2;
    const screenY = rect.height / 2;
    setTransform((current) => {
      const nextScale = clampScale(current.scale * multiplier);
      const worldPoint = screenToWorld(screenX, screenY, current);
      return {
        scale: nextScale,
        offsetX: screenX - worldPoint.x * nextScale,
        offsetY: screenY - worldPoint.y * nextScale
      };
    });
  }

  function isEmbeddedWindow(windowInfo: VirtualWindowState, forceEmbedded = false): boolean {
    return forceEmbedded || Boolean(windowInfo.hwnd && embeddedWindowIdSet.has(windowInfo.hwnd));
  }

  function shouldShowNativeEmbeddedWindow(windowInfo: VirtualWindowState, forceEmbedded = false): boolean {
    return isEmbeddedWindow(windowInfo, forceEmbedded) && transform.scale >= NATIVE_EMBEDDED_VISIBLE_SCALE;
  }

  function getFrameScreenBounds(windowInfo: VirtualWindowState, forceEmbedded = false): { x: number; y: number; width: number; height: number } {
    const position = worldToScreen(windowInfo.virtualX, windowInfo.virtualY, transform);
    if (shouldShowNativeEmbeddedWindow(windowInfo, forceEmbedded)) {
      const contentWidth = Math.max(1, windowInfo.width);
      const contentHeight = Math.max(1, windowInfo.height);
      return {
        x: position.x,
        y: position.y,
        width: contentWidth + EMBEDDED_NODE_CHROME_WIDTH,
        height: contentHeight + EMBEDDED_NODE_CHROME_HEIGHT
      };
    }

    return {
      x: position.x,
      y: position.y,
      width: Math.max(180, windowInfo.width * transform.scale),
      height: Math.max(130, windowInfo.height * transform.scale)
    };
  }

  function getEmbeddedContentBounds(windowInfo: VirtualWindowState, forceEmbedded = false): MoveEmbeddedWindowParams {
    const frame = getFrameScreenBounds(windowInfo, forceEmbedded);
    if (!shouldShowNativeEmbeddedWindow(windowInfo, forceEmbedded)) {
      return {
        hwnd: windowInfo.hwnd || '',
        x: HIDDEN_EMBEDDED_WINDOW_X,
        y: HIDDEN_EMBEDDED_WINDOW_Y,
        width: Math.max(1, Math.round(windowInfo.width)),
        height: Math.max(1, Math.round(windowInfo.height))
      };
    }

    return {
      hwnd: windowInfo.hwnd || '',
      x: Math.round(frame.x + EMBEDDED_NODE_CONTENT_INSET_X),
      y: Math.round(frame.y + EMBEDDED_NODE_CONTENT_INSET_TOP),
      width: Math.max(1, Math.round(frame.width - EMBEDDED_NODE_CHROME_WIDTH)),
      height: Math.max(1, Math.round(frame.height - EMBEDDED_NODE_CONTENT_INSET_TOP - EMBEDDED_NODE_CONTENT_INSET_BOTTOM))
    };
  }

  function getDwmPreviewWindow(windowInfo: VirtualWindowState): DwmPreviewWindow | null {
    if (!windowInfo.hwnd || shouldShowNativeEmbeddedWindow(windowInfo)) {
      return null;
    }

    const frame = getFrameScreenBounds(windowInfo);
    const canvas = canvasRef.current;
    const canvasWidth = canvas?.clientWidth || 0;
    const canvasHeight = canvas?.clientHeight || 0;
    const titlebarHeight = 38;
    const inset = 10;
    const previewX = frame.x + inset;
    const previewY = frame.y + titlebarHeight + inset;
    const previewWidth = frame.width - inset * 2;
    const previewHeight = frame.height - titlebarHeight - inset * 2;

    if (previewWidth <= 20 || previewHeight <= 20) {
      return null;
    }

    if (
      canvasWidth > 0 &&
      canvasHeight > 0 &&
      (previewX < 0 || previewY < 0 || previewX + previewWidth > canvasWidth || previewY + previewHeight > canvasHeight)
    ) {
      return null;
    }

    return {
      id: windowInfo.hwnd,
      hwnd: windowInfo.hwnd,
      x: Math.round(previewX),
      y: Math.round(previewY),
      width: Math.max(1, Math.round(previewWidth)),
      height: Math.max(1, Math.round(previewHeight)),
      visible: true,
      opacity: 245
    };
  }

  function flushEmbeddedWindowPositions(): void {
    if (embeddedWindowIds.length === 0) {
      return;
    }

    windowsRef.current.forEach((windowInfo) => {
      if (!windowInfo.hwnd || !embeddedWindowIdSet.has(windowInfo.hwnd)) {
        return;
      }

      scheduleEmbeddedMove(getEmbeddedContentBounds(windowInfo), true);
    });
  }

  useEffect(() => {
    fitView();
  }, [fitSignal]);

  useEffect(() => {
    setTransform(DEFAULT_TRANSFORM);
  }, [resetViewSignal]);

  useEffect(() => {
    if (zoomInSignal > 0) {
      zoomBy(1.12);
    }
  }, [zoomInSignal]);

  useEffect(() => {
    if (zoomOutSignal > 0) {
      zoomBy(0.88);
    }
  }, [zoomOutSignal]);

  useEffect(() => {
    if (embeddedWindowIds.length === 0) {
      return;
    }

    windows.forEach((windowInfo) => {
      if (!windowInfo.hwnd || !embeddedWindowIdSet.has(windowInfo.hwnd)) {
        return;
      }

      scheduleEmbeddedMove(getEmbeddedContentBounds(windowInfo));
    });
  }, [embeddedWindowIdSet, embeddedWindowIds.length, transform, windows]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const previews = windows.map((windowInfo) => getDwmPreviewWindow(windowInfo)).filter((preview): preview is DwmPreviewWindow => preview !== null);
      onSyncDwmPreviews(previews);
    }, DWM_PREVIEW_SYNC_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [embeddedWindowIdSet, transform, viewportVersion, windows]);

  useEffect(() => {
    return () => {
      onClearDwmPreviews();
    };
  }, []);

  useEffect(() => {
    function closeContextMenu(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    }

    window.addEventListener('keydown', closeContextMenu);
    return () => window.removeEventListener('keydown', closeContextMenu);
  }, []);

  function createRegionAt(worldX: number, worldY: number): void {
    const defaultName = `Template ${regionsRef.current.length + 1}`;
    const name = window.prompt('Name template region', defaultName)?.trim() || defaultName;
    const nextRegion: TemplateRegion = {
      id: crypto.randomUUID(),
      name,
      x: Math.round(worldX),
      y: Math.round(worldY),
      width: DEFAULT_REGION_WIDTH,
      height: DEFAULT_REGION_HEIGHT,
      windowIds: [],
      color: REGION_COLORS[regionsRef.current.length % REGION_COLORS.length],
      createdAt: new Date().toISOString(),
      isDirty: true
    };
    onRegionsChange(updateRegionMembership(windowsRef.current, [...regionsRef.current, nextRegion]));
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return;
    }

    setContextMenu(null);
    onSelectRegion(null);
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (event.ctrlKey) {
      const worldPoint = screenToWorld(screenX, screenY, transform);
      dragRef.current = {
        type: 'create-region',
        startWorldX: worldPoint.x,
        startWorldY: worldPoint.y
      };
      setDraftRegion({
        id: 'draft',
        name: 'New Template',
        x: worldPoint.x,
        y: worldPoint.y,
        width: 0,
        height: 0,
        windowIds: [],
        color: REGION_COLORS[regions.length % REGION_COLORS.length],
        createdAt: new Date().toISOString()
      });
      setDragMode('create-region');
    } else {
      dragRef.current = {
        type: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY
      };
      setDragMode('pan');
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleWindowPointerDown(
    event: React.PointerEvent<HTMLElement>,
    windowInfo: VirtualWindowState,
    key: string
  ): void {
    if (event.button !== 0) {
      return;
    }

    setContextMenu(null);
    event.stopPropagation();
    dragRef.current = {
      type: 'window',
      key,
      startX: event.clientX,
      startY: event.clientY,
      virtualX: windowInfo.virtualX,
      virtualY: windowInfo.virtualY,
      moved: false
    };
    setDragMode('window');
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleRegionPointerDown(event: React.PointerEvent<HTMLElement>, region: TemplateRegion): void {
    if (event.button !== 0) {
      return;
    }

    setContextMenu(null);
    onSelectRegion(region.id);
    event.stopPropagation();
    const ids = new Set(region.windowIds);
    dragRef.current = {
      type: 'region',
      id: region.id,
      startX: event.clientX,
      startY: event.clientY,
      regionX: region.x,
      regionY: region.y,
      windowPositions: windows
        .filter((windowInfo) => ids.has(getWindowIdentity(windowInfo)))
        .map((windowInfo) => ({
          id: getWindowIdentity(windowInfo),
          virtualX: windowInfo.virtualX,
          virtualY: windowInfo.virtualY
        }))
    };
    setDragMode('region');
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function renameRegion(region: TemplateRegion): void {
    const name = window.prompt('Rename template region', region.name);
    if (!name || name.trim().length === 0) {
      return;
    }

    onRegionsChange(
      regionsRef.current.map((item) =>
        item.id === region.id
          ? {
              ...item,
              name: name.trim(),
              isDirty: true
            }
          : item
      )
    );
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    if (drag.type === 'pan') {
      setTransform((current) => ({
        ...current,
        offsetX: drag.offsetX + event.clientX - drag.startX,
        offsetY: drag.offsetY + event.clientY - drag.startY
      }));
      return;
    }

    if (drag.type === 'create-region') {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const worldPoint = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, transform);
      setDraftRegion((current) =>
        current
          ? {
              ...current,
              width: worldPoint.x - drag.startWorldX,
              height: worldPoint.y - drag.startWorldY
            }
          : current
      );
      return;
    }

    const deltaX = (event.clientX - drag.startX) / transform.scale;
    const deltaY = (event.clientY - drag.startY) / transform.scale;

    if (drag.type === 'window') {
      let movedWindow: VirtualWindowState | null = null;
      drag.moved = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
      const nextWindows = windowsRef.current.map((windowInfo, index) => {
        if (getWindowKey(windowInfo, index) !== drag.key) {
          return windowInfo;
        }

        movedWindow = {
          ...windowInfo,
          virtualX: Math.round(drag.virtualX + deltaX),
          virtualY: Math.round(drag.virtualY + deltaY),
          isDirty: true
        };
        return movedWindow;
      });
      windowsRef.current = nextWindows;
      onWindowsChange(nextWindows);
      if (movedWindow) {
        scheduleLiveMove(movedWindow);
      }
      return;
    }

    const movingIds = new Map(drag.windowPositions.map((item) => [item.id, item]));
    const nextRegions = regionsRef.current.map((region) =>
      region.id === drag.id
        ? {
            ...region,
            x: Math.round(drag.regionX + deltaX),
            y: Math.round(drag.regionY + deltaY),
            isDirty: true
          }
        : region
    );
    const nextWindows = windowsRef.current.map((windowInfo) => {
      const startingPosition = movingIds.get(getWindowIdentity(windowInfo));
      if (!startingPosition) {
        return windowInfo;
      }

      return {
        ...windowInfo,
        virtualX: Math.round(startingPosition.virtualX + deltaX),
        virtualY: Math.round(startingPosition.virtualY + deltaY),
        isDirty: true
      };
    });

    windowsRef.current = nextWindows;
    regionsRef.current = nextRegions;
    onWindowsChange(nextWindows);
    onRegionsChange(nextRegions);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;

    if (drag?.type === 'create-region' && draftRegion) {
      const normalized = normalizeDraftRegion(draftRegion);
      if (normalized.width >= MIN_REGION_WIDTH && normalized.height >= MIN_REGION_HEIGHT) {
        const defaultName = `Template ${regions.length + 1}`;
        const name = window.prompt('Name template region', defaultName)?.trim() || defaultName;
        const nextRegion: TemplateRegion = {
          ...normalized,
          id: crypto.randomUUID(),
          name,
          isDirty: true
        };
        onRegionsChange(updateRegionMembership(windowsRef.current, [...regionsRef.current, nextRegion]));
      }
    } else if (drag?.type === 'window' || drag?.type === 'region') {
      onRegionsChange(updateRegionMembership(windowsRef.current, regionsRef.current));
      flushEmbeddedWindowPositions();
    }

    if (drag?.type === 'window' && !drag.moved && liveControlEnabled) {
      const targetWindow = windowsRef.current.find((windowInfo, index) => getWindowKey(windowInfo, index) === drag.key);
      if (targetWindow?.hwnd) {
        onWorkWindow(targetWindow.hwnd);
      }
    }

    dragRef.current = null;
    setDraftRegion(null);
    setDragMode('none');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    setTransform((current) => {
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      const nextScale = clampScale(current.scale * zoomFactor);
      const worldPoint = screenToWorld(screenX, screenY, current);

      return {
        scale: nextScale,
        offsetX: screenX - worldPoint.x * nextScale,
        offsetY: screenY - worldPoint.y * nextScale
      };
    });
  }

  function handleCanvasContextMenu(event: React.MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const worldPoint = screenToWorld(screenX, screenY, transform);
    setContextMenu({
      type: 'canvas',
      screenX,
      screenY,
      worldX: worldPoint.x,
      worldY: worldPoint.y
    });
  }

  function resetWindowPosition(key: string): void {
    const nextWindows = windowsRef.current.map((windowInfo, index) =>
      getWindowKey(windowInfo, index) === key
        ? {
            ...windowInfo,
            virtualX: windowInfo.initialVirtualX ?? windowInfo.realX,
            virtualY: windowInfo.initialVirtualY ?? windowInfo.realY,
            isDirty: false
          }
        : windowInfo
    );
    windowsRef.current = nextWindows;
    onWindowsChange(nextWindows);
    onRegionsChange(updateRegionMembership(nextWindows, regionsRef.current));
  }

  function removeWindowFromCanvas(key: string): void {
    const nextWindows = windowsRef.current.filter((windowInfo, index) => getWindowKey(windowInfo, index) !== key);
    windowsRef.current = nextWindows;
    onWindowsChange(nextWindows);
    onRegionsChange(updateRegionMembership(nextWindows, regionsRef.current));
  }

  function deleteRegion(id: string): void {
    const nextRegions = regionsRef.current.filter((region) => region.id !== id);
    regionsRef.current = nextRegions;
    onRegionsChange(nextRegions);
  }

  function runWindowCommand(windowInfo: VirtualWindowState, command: WindowCommand): void {
    if (!windowInfo.hwnd) {
      return;
    }

    onWindowCommand(windowInfo.hwnd, command);
  }

  function workInWindow(windowInfo: VirtualWindowState): void {
    if (!windowInfo.hwnd) {
      return;
    }

    onWorkWindow(windowInfo.hwnd);
  }

  function embedWindow(windowInfo: VirtualWindowState): void {
    if (!windowInfo.hwnd) {
      return;
    }

    onEmbedWindow(windowInfo, getEmbeddedContentBounds(windowInfo, true));
  }

  function detachEmbeddedWindow(windowInfo: VirtualWindowState): void {
    if (!windowInfo.hwnd) {
      return;
    }

    onDetachEmbeddedWindow(windowInfo.hwnd);
  }

    const renderedRegions = draftRegion ? [...regions, normalizeDraftRegion(draftRegion)] : regions;
  const contextWindow =
    contextMenu?.type === 'window'
      ? windows.find((windowInfo, index) => getWindowKey(windowInfo, index) === contextMenu.key)
      : null;
  const contextRegion = contextMenu?.type === 'region' ? regions.find((region) => region.id === contextMenu.id) : null;

  return (
    <section className="canvas-preview">
      <div
        ref={canvasRef}
        className={`canvas-surface ${dragMode === 'pan' ? 'dragging' : ''} ${dragMode !== 'none' && dragMode !== 'pan' ? 'moving-window' : ''}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={handleCanvasContextMenu}
      >
        {bounds ? (
          <div
            className="canvas-bounds"
            style={{
              left: worldToScreen(bounds.x, bounds.y, transform).x,
              top: worldToScreen(bounds.x, bounds.y, transform).y,
              width: bounds.width * transform.scale,
              height: bounds.height * transform.scale
            }}
          />
        ) : null}

        {renderedRegions.map((region) => {
          const position = worldToScreen(region.x, region.y, transform);
          return (
            <section
              className={`template-region ${region.id === 'draft' ? 'draft-region' : ''} ${region.isDirty ? 'dirty-region' : ''} ${
                selectedRegionId === region.id ? 'selected-region' : ''
              }`}
              key={region.id}
              style={{
                left: position.x,
                top: position.y,
                width: region.width * transform.scale,
                height: region.height * transform.scale,
                borderColor: region.color,
                backgroundColor: `${region.color || '#2f7666'}1f`
              }}
              onPointerDown={(event) => region.id !== 'draft' && handleRegionPointerDown(event, region)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const canvas = canvasRef.current;
                if (!canvas) {
                  return;
                }
                const rect = canvas.getBoundingClientRect();
                setContextMenu({
                  type: 'region',
                  screenX: event.clientX - rect.left,
                  screenY: event.clientY - rect.top,
                  id: region.id
                });
                onSelectRegion(region.id);
              }}
            >
              <button className="region-label" onDoubleClick={() => renameRegion(region)} title="Double-click to rename">
                <strong>{region.name}</strong>
                <span>{region.windowIds.length} windows</span>
              </button>
              {region.id !== 'draft' && region.windowIds.length === 0 ? (
                <div className="region-empty-hint">Drop windows here or launch apps from Dock</div>
              ) : null}
            </section>
          );
        })}

        {windows.length === 0 ? (
          <div className="canvas-empty">
            <strong>Scan Windows to start.</strong>
            <span>Then Ctrl+Drag on the canvas to create a template region.</span>
          </div>
        ) : (
          windows.map((windowInfo, index) => {
            const key = getWindowKey(windowInfo, index);
            const frame = getFrameScreenBounds(windowInfo);
            const isEmbedded = isEmbeddedWindow(windowInfo);
            const isNativeEmbeddedVisible = shouldShowNativeEmbeddedWindow(windowInfo);
            return (
              <article
                className={`virtual-window ${windowInfo.isHelper ? 'helper-window' : ''} ${windowInfo.isDirty ? 'dirty-window' : ''} ${
                  isEmbedded ? 'embedded-window' : ''
                } ${isEmbedded && !isNativeEmbeddedVisible ? 'embedded-overview-window' : ''}`}
                key={key}
                style={{
                  left: frame.x,
                  top: frame.y,
                  width: frame.width,
                  height: frame.height
                }}
                onPointerDown={(event) => handleWindowPointerDown(event, windowInfo, key)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const canvas = canvasRef.current;
                  if (!canvas) {
                    return;
                  }
                  const rect = canvas.getBoundingClientRect();
                  setContextMenu({
                    type: 'window',
                    screenX: event.clientX - rect.left,
                    screenY: event.clientY - rect.top,
                    key
                  });
                }}
              >
                <div className="virtual-titlebar">
                  <div className="virtual-window-meta">
                    <strong>{windowInfo.title}</strong>
                    <span>{windowInfo.processName}</span>
                  </div>
                  <div className="virtual-window-actions" onPointerDown={(event) => event.stopPropagation()}>
                    {windowInfo.isDirty ? <em>Edited</em> : null}
                    {isEmbedded && !isNativeEmbeddedVisible ? <em>Overview</em> : null}
                    {windowInfo.hwnd ? (
                      <>
                        {experimentalEmbedEnabled || isEmbedded ? (
                          isEmbedded ? (
                            <button className="embed-window-command" title="Detach embedded real window" onClick={() => detachEmbeddedWindow(windowInfo)}>
                              Detach
                            </button>
                          ) : (
                            <button className="embed-window-command" title="Embed real window into this node" onClick={() => embedWindow(windowInfo)}>
                              Embed
                            </button>
                          )
                        ) : null}
                        <button className="work-window-command" title="Work in real window" onClick={() => workInWindow(windowInfo)}>
                          Work
                        </button>
                        <button title="Focus real window" onClick={() => runWindowCommand(windowInfo, 'focus')}>
                          <Focus size={11} />
                        </button>
                        <button title="Minimize real window" onClick={() => runWindowCommand(windowInfo, 'minimize')}>
                          <Minimize2 size={11} />
                        </button>
                        <button title="Maximize real window" onClick={() => runWindowCommand(windowInfo, 'maximize')}>
                          <Maximize2 size={11} />
                        </button>
                        <button title="Restore real window" onClick={() => runWindowCommand(windowInfo, 'restore')}>
                          <RotateCcw size={11} />
                        </button>
                        <button className="danger-window-command" title="Close real window" onClick={() => runWindowCommand(windowInfo, 'close')}>
                          <X size={11} />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className={`virtual-content ${isEmbedded && isNativeEmbeddedVisible ? 'embedded-content' : ''}`}>
                  {isEmbedded && isNativeEmbeddedVisible ? null : (
                    <>
                      <WindowPlaceholder processName={windowInfo.processName} />
                      <span>
                        {windowInfo.width} x {windowInfo.height}
                      </span>
                      <span>
                        {windowInfo.virtualX}, {windowInfo.virtualY}
                      </span>
                      {windowInfo.isHelper ? <b>Helper</b> : null}
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}

        <div className="canvas-status-overlay">
          {previewLabel}
        </div>

        {contextMenu ? (
          <div className="context-menu" style={{ left: contextMenu.screenX, top: contextMenu.screenY }}>
            {contextMenu.type === 'canvas' ? (
              <>
                <button onClick={() => { setContextMenu(null); onScanWindows(); }}>Scan Windows</button>
                <button onClick={() => { createRegionAt(contextMenu.worldX, contextMenu.worldY); setContextMenu(null); }}>Create Region Here</button>
                <button onClick={() => { setContextMenu(null); onSaveRegions(); }}>Save Regions</button>
                <button onClick={() => { setContextMenu(null); fitView(); }}>Fit View</button>
                <button onClick={() => { setContextMenu(null); setTransform(DEFAULT_TRANSFORM); }}>Reset View</button>
              </>
            ) : null}

            {contextMenu.type === 'window' && contextWindow ? (
              <>
                {contextWindow.hwnd ? (
                  <>
                    {experimentalEmbedEnabled || embeddedWindowIdSet.has(contextWindow.hwnd) ? (
                      embeddedWindowIdSet.has(contextWindow.hwnd) ? (
                        <button onClick={() => { setContextMenu(null); detachEmbeddedWindow(contextWindow); }}>Detach Embedded Window</button>
                      ) : (
                        <button onClick={() => { setContextMenu(null); embedWindow(contextWindow); }}>Embed Real Window</button>
                      )
                    ) : null}
                    <button onClick={() => { setContextMenu(null); workInWindow(contextWindow); }}>Work in Real Window</button>
                    <button onClick={() => { setContextMenu(null); runWindowCommand(contextWindow, 'focus'); }}>Focus Real Window</button>
                    <button onClick={() => { setContextMenu(null); runWindowCommand(contextWindow, 'minimize'); }}>Minimize Real Window</button>
                    <button onClick={() => { setContextMenu(null); runWindowCommand(contextWindow, 'maximize'); }}>Maximize Real Window</button>
                    <button onClick={() => { setContextMenu(null); runWindowCommand(contextWindow, 'restore'); }}>Restore Real Window</button>
                  </>
                ) : null}
                <button onClick={() => { setContextMenu(null); onApplyWindows([contextWindow]); }}>Apply This Window</button>
                <button onClick={() => { resetWindowPosition(contextMenu.key); setContextMenu(null); }}>Reset Window Position</button>
                <button onClick={() => { removeWindowFromCanvas(contextMenu.key); setContextMenu(null); }}>Remove from Canvas</button>
                {contextWindow.hwnd ? (
                  <button onClick={() => { setContextMenu(null); runWindowCommand(contextWindow, 'close'); }}>Close Real Window</button>
                ) : null}
              </>
            ) : null}

            {contextMenu.type === 'region' && contextRegion ? (
              <>
                <button onClick={() => { renameRegion(contextRegion); setContextMenu(null); }}>Rename Region</button>
                <button onClick={() => { setContextMenu(null); onSaveRegion(contextRegion); }}>Save This Region</button>
                <button
                  onClick={() => {
                    const ids = new Set(contextRegion.windowIds);
                    setContextMenu(null);
                    onApplyWindows(windows.filter((windowInfo) => ids.has(getWindowIdentity(windowInfo))));
                  }}
                >
                  Apply Region
                </button>
                <button onClick={() => { deleteRegion(contextRegion.id); setContextMenu(null); }}>Delete Region</button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
