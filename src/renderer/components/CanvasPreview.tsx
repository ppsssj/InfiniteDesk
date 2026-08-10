import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Focus, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import { clampScale, easeOutCubic, interpolateCanvasTransform, screenToWorld, worldToScreen, type CanvasTransform } from '../canvas/transform';
import { getWindowIdentity, updateRegionMembership } from '../canvas/regions';
import type { DwmPreviewWindow, WindowCommand } from '../../shared/types';
import type { TemplateRegion, VirtualWindowState } from '../canvas/types';
import type { CanvasPreviewProps, PanDrag, CreateRegionDrag, WindowDrag, RegionDrag, ContextMenuState } from './CanvasPreview.types';
import {
  DEFAULT_REGION_WIDTH,
  DEFAULT_REGION_HEIGHT,
  MIN_REGION_WIDTH,
  MIN_REGION_HEIGHT,
  OVERVIEW_CONTENT_INSET,
  OVERVIEW_TITLEBAR_HEIGHT,
  COMPACT_OVERVIEW_SCALE,
  REGION_COLORS
} from './CanvasPreview.constants';
import { getWindowKey, normalizeDraftRegion, getSafeCanvasBounds } from './CanvasPreview.helpers';
import { WindowPlaceholder } from './WindowPlaceholder';
import { CanvasContextMenu } from './CanvasContextMenu';
import { useViewportVersion } from '../hooks/useViewportVersion';
import { useCanvasTransform } from '../hooks/useCanvasTransform';
import { useWindowFrameGeometry } from '../hooks/useWindowFrameGeometry';
import { useEmbeddedWindowSync } from '../hooks/useEmbeddedWindowSync';
import { useMirrorPointerRelay } from '../hooks/useMirrorPointerRelay';

const CAMERA_FOCUS_ANIMATION_MS = 360;

export function CanvasPreview({
  windows,
  regions,
  safeArea,
  uiOverlayActive,
  selectedRegionId,
  embeddedWindowIds,
  onWindowsChange,
  onRegionsChange,
  onSelectRegion,
  onWorkWindow,
  onWindowCommand,
  onEmbedWindow,
  onDetachEmbeddedWindow,
  onMoveEmbeddedWindow,
  onSyncDwmPreviews,
  onClearDwmPreviews,
  onRelayPointerInput,
  onScanWindows,
  onSaveRegions,
  onApplyWindows,
  onSaveRegion,
  fitSignal,
  resetViewSignal,
  zoomInSignal,
  zoomOutSignal,
  cameraFocusRequest,
  onZoomChange
}: CanvasPreviewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<PanDrag | CreateRegionDrag | WindowDrag | RegionDrag | null>(null);
  const windowsRef = useRef(windows);
  const regionsRef = useRef(regions);
  const handledCameraFocusRequestRef = useRef(0);
  const cameraAnimationFrameRef = useRef<number | null>(null);
  const transformRef = useRef<CanvasTransform>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [dragMode, setDragMode] = useState<'none' | 'pan' | 'window' | 'region' | 'create-region'>('none');
  const [draftRegion, setDraftRegion] = useState<TemplateRegion | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const embeddedWindowIdSet = useMemo(() => new Set(embeddedWindowIds), [embeddedWindowIds]);
  const shouldSuspendNativePreviews = false;

  const viewportVersion = useViewportVersion(canvasRef);

  const { transform, setTransform, fitView, getDefaultTransform } = useCanvasTransform({
    canvasRef,
    windows,
    safeArea,
    fitSignal,
    resetViewSignal,
    zoomInSignal,
    zoomOutSignal,
    onZoomChange
  });

  transformRef.current = transform;

  const {
    isEmbeddedWindow,
    shouldShowNativeEmbeddedWindow,
    getVisiblePreviewRects,
    getFrameScreenBounds,
    getOverviewContentScreenBounds,
    getEmbeddedContentBounds,
    getInteractiveEmbedTransform
  } = useWindowFrameGeometry({
    canvasRef,
    safeArea,
    transform,
    embeddedWindowIdSet,
    shouldSuspendNativePreviews
  });

  const { flushEmbeddedWindowPositions } = useEmbeddedWindowSync({
    windows,
    windowsRef,
    embeddedWindowIds,
    embeddedWindowIdSet,
    onMoveEmbeddedWindow,
    getEmbeddedContentBounds,
    safeArea,
    transform,
    shouldSuspendNativePreviews
  });

  const { relayMirrorPointer, handleMirrorPointerDown, handleMirrorPointerUp, handleMirrorPointerCancel } = useMirrorPointerRelay({
    canvasRef,
    getOverviewContentScreenBounds,
    onRelayPointerInput
  });

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  function cancelCameraAnimation(): void {
    if (cameraAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraAnimationFrameRef.current);
      cameraAnimationFrameRef.current = null;
    }
  }

  function animateCameraTo(targetTransform: CanvasTransform): void {
    cancelCameraAnimation();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transformRef.current = targetTransform;
      setTransform(targetTransform);
      return;
    }

    const startTransform = { ...transformRef.current };
    const startedAt = window.performance.now();
    const animateFrame = (timestamp: number): void => {
      const rawProgress = Math.min(1, (timestamp - startedAt) / CAMERA_FOCUS_ANIMATION_MS);
      const nextTransform = interpolateCanvasTransform(startTransform, targetTransform, easeOutCubic(rawProgress));
      transformRef.current = nextTransform;
      setTransform(nextTransform);

      if (rawProgress < 1) {
        cameraAnimationFrameRef.current = window.requestAnimationFrame(animateFrame);
      } else {
        cameraAnimationFrameRef.current = null;
      }
    };

    cameraAnimationFrameRef.current = window.requestAnimationFrame(animateFrame);
  }

  useEffect(() => () => cancelCameraAnimation(), []);

  useEffect(() => {
    cancelCameraAnimation();
  }, [fitSignal, resetViewSignal, zoomInSignal, zoomOutSignal]);

  useEffect(() => {
    if (shouldSuspendNativePreviews) {
      onClearDwmPreviews();
      flushEmbeddedWindowPositions();
    }
  }, [shouldSuspendNativePreviews]);

  function getDwmPreviewWindows(windowInfo: VirtualWindowState): DwmPreviewWindow[] {
    if (!windowInfo.hwnd || shouldShowNativeEmbeddedWindow(windowInfo)) {
      return [];
    }

    const previewBounds = getOverviewContentScreenBounds(windowInfo);
    const canvas = canvasRef.current;
    const canvasWidth = canvas?.clientWidth || 0;
    const canvasHeight = canvas?.clientHeight || 0;
    const canvasRect = canvas?.getBoundingClientRect();
    const canvasOffsetX = canvasRect?.left || 0;
    const canvasOffsetY = canvasRect?.top || 0;

    if (previewBounds.width <= 20 || previewBounds.height <= 20) {
      return [];
    }

    return getVisiblePreviewRects(previewBounds, canvasWidth, canvasHeight).map((visibleBounds, segmentIndex) => ({
      id: `${windowInfo.hwnd}:segment:${segmentIndex}`,
      hwnd: windowInfo.hwnd!,
      x: Math.round(canvasOffsetX + visibleBounds.x),
      y: Math.round(canvasOffsetY + visibleBounds.y),
      width: Math.max(1, Math.round(visibleBounds.width)),
      height: Math.max(1, Math.round(visibleBounds.height)),
      cropX: Math.min(1, Math.max(0, (visibleBounds.x - previewBounds.x) / previewBounds.width)),
      cropY: Math.min(1, Math.max(0, (visibleBounds.y - previewBounds.y) / previewBounds.height)),
      cropWidth: Math.min(1, Math.max(0.0001, visibleBounds.width / previewBounds.width)),
      cropHeight: Math.min(1, Math.max(0.0001, visibleBounds.height / previewBounds.height)),
      visible: true,
      opacity: 245
    }));
  }

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      if (shouldSuspendNativePreviews) {
        onClearDwmPreviews();
        return;
      }

      const previews = windows.flatMap((windowInfo) => getDwmPreviewWindows(windowInfo));
      onSyncDwmPreviews(previews);
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [contextMenu, embeddedWindowIdSet, selectedRegionId, shouldSuspendNativePreviews, transform, uiOverlayActive, viewportVersion, windows]);

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

    cancelCameraAnimation();
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

    cancelCameraAnimation();
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

    cancelCameraAnimation();
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
      drag.moved = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
      const nextWindows = windowsRef.current.map((windowInfo, index) => {
        if (getWindowKey(windowInfo, index) !== drag.key) {
          return windowInfo;
        }

        return {
          ...windowInfo,
          virtualX: Math.round(drag.virtualX + deltaX),
          virtualY: Math.round(drag.virtualY + deltaY),
          isDirty: true
        };
      });
      windowsRef.current = nextWindows;
      onWindowsChange(nextWindows);
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

    dragRef.current = null;
    setDraftRegion(null);
    setDragMode('none');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    cancelCameraAnimation();
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

    cancelCameraAnimation();
    const interactiveTransform = getInteractiveEmbedTransform(windowInfo);
    setTransform(interactiveTransform);
    onEmbedWindow(windowInfo, getEmbeddedContentBounds(windowInfo, true, interactiveTransform));
  }

  function detachEmbeddedWindow(windowInfo: VirtualWindowState): void {
    if (!windowInfo.hwnd) {
      return;
    }

    onDetachEmbeddedWindow(windowInfo.hwnd);
  }

  function zoomToWindowNode(windowInfo: VirtualWindowState): void {
    cancelCameraAnimation();
    const canvas = canvasRef.current;
    const canvasWidth = canvas?.clientWidth || window.innerWidth;
    const canvasHeight = canvas?.clientHeight || window.innerHeight;
    const { safeWidth, safeHeight, safeCenterX, safeCenterY } = getSafeCanvasBounds(canvasWidth, canvasHeight, safeArea);
    const maximumVisibleScale = Math.min(
      Math.max(0.01, (safeWidth - OVERVIEW_CONTENT_INSET * 2) / Math.max(1, windowInfo.width)),
      Math.max(0.01, (safeHeight - OVERVIEW_TITLEBAR_HEIGHT - OVERVIEW_CONTENT_INSET * 2) / Math.max(1, windowInfo.height))
    );
    const desiredScale = Math.min(1.35, Math.max(0.3, transform.scale * 1.55));
    const nextScale = clampScale(Math.min(desiredScale, maximumVisibleScale));

    setTransform({
      scale: nextScale,
      offsetX: Math.round(safeCenterX - (windowInfo.virtualX + windowInfo.width / 2) * nextScale - OVERVIEW_CONTENT_INSET),
      offsetY: Math.round(
        safeCenterY - (windowInfo.virtualY + windowInfo.height / 2) * nextScale - OVERVIEW_TITLEBAR_HEIGHT - OVERVIEW_CONTENT_INSET
      )
    });
  }

  function focusWindowNode(windowInfo: VirtualWindowState): void {
    const canvas = canvasRef.current;
    const canvasWidth = canvas?.clientWidth || window.innerWidth;
    const canvasHeight = canvas?.clientHeight || window.innerHeight;
    const { safeCenterX, safeCenterY } = getSafeCanvasBounds(canvasWidth, canvasHeight, safeArea);
    const nextScale = clampScale(Math.max(transform.scale, 0.18));

    animateCameraTo({
      scale: nextScale,
      offsetX: Math.round(safeCenterX - (windowInfo.virtualX + windowInfo.width / 2) * nextScale),
      offsetY: Math.round(safeCenterY - (windowInfo.virtualY + windowInfo.height / 2) * nextScale)
    });
  }

  useEffect(() => {
    if (!cameraFocusRequest || handledCameraFocusRequestRef.current === cameraFocusRequest.id) {
      return;
    }

    const targetWindow = windows.find(
      (windowInfo) => windowInfo.hwnd?.toLowerCase() === cameraFocusRequest.hwnd.toLowerCase()
    );
    if (!targetWindow) {
      return;
    }

    handledCameraFocusRequestRef.current = cameraFocusRequest.id;
    focusWindowNode(targetWindow);
  }, [cameraFocusRequest, windows]);

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
            const isCompactOverview = !isEmbedded && transform.scale < COMPACT_OVERVIEW_SCALE;
            return (
              <article
                className={`virtual-window ${!isEmbedded ? 'overview-window' : ''} ${isCompactOverview ? 'compact-overview-window' : ''} ${windowInfo.isHelper ? 'helper-window' : ''} ${windowInfo.isDirty ? 'dirty-window' : ''} ${
                  isEmbedded ? 'embedded-window' : ''
                } ${isEmbedded && !isNativeEmbeddedVisible ? 'embedded-overview-window' : ''}`}
                key={key}
                title={isCompactOverview ? `${windowInfo.title} — ${windowInfo.processName}` : undefined}
                style={{
                  left: frame.x,
                  top: frame.y,
                  width: frame.width,
                  height: frame.height
                }}
                onPointerDown={(event) => handleWindowPointerDown(event, windowInfo, key)}
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) {
                    return;
                  }
                  event.stopPropagation();
                  zoomToWindowNode(windowInfo);
                }}
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
                    {isEmbedded && !isNativeEmbeddedVisible ? <em>Zoom In</em> : null}
                    {windowInfo.hwnd ? (
                      <>
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
                <div
                  className={`virtual-content ${isEmbedded && isNativeEmbeddedVisible ? 'embedded-content' : ''}`}
                  role="application"
                  tabIndex={0}
                  aria-label={`Control ${windowInfo.title}`}
                  onPointerDown={(event) => handleMirrorPointerDown(event, windowInfo)}
                  onPointerMove={(event) => relayMirrorPointer(event, windowInfo, 'move')}
                  onPointerUp={(event) => handleMirrorPointerUp(event, windowInfo)}
                  onPointerCancel={(event) => handleMirrorPointerCancel(event, windowInfo)}
                  onWheel={(event) => relayMirrorPointer(event, windowInfo, 'wheel')}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
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

        {contextMenu ? (
          <CanvasContextMenu
            contextMenu={contextMenu}
            contextWindow={contextWindow ?? null}
            contextRegion={contextRegion ?? null}
            onClose={() => setContextMenu(null)}
            onScanWindows={onScanWindows}
            onCreateRegionHere={createRegionAt}
            onSaveRegions={onSaveRegions}
            onFitView={fitView}
            onResetView={() => setTransform(getDefaultTransform())}
            onZoomToWindow={zoomToWindowNode}
            onWorkInWindow={workInWindow}
            onRunWindowCommand={runWindowCommand}
            onApplyWindow={(windowInfo) => onApplyWindows([windowInfo])}
            onResetWindowPosition={resetWindowPosition}
            onRemoveWindowFromCanvas={removeWindowFromCanvas}
            onRenameRegion={renameRegion}
            onSaveRegion={onSaveRegion}
            onApplyRegion={(region) => {
              const ids = new Set(region.windowIds);
              onApplyWindows(windows.filter((windowInfo) => ids.has(getWindowIdentity(windowInfo))));
            }}
            onDeleteRegion={deleteRegion}
          />
        ) : null}
      </div>
    </section>
  );
}
