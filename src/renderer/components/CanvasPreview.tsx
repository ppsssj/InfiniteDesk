import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Focus, Maximize2, Minimize2, MousePointer2, RotateCcw, X } from 'lucide-react';
import { clampScale, easeOutCubic, interpolateCanvasTransform, screenToWorld, worldToScreen, type CanvasTransform } from '../canvas/transform';
import { updateRegionMembership } from '../canvas/regions';
import type { DwmPreviewWindow, WindowCommand } from '../../shared/types';
import type { TemplateRegion, VirtualWindowState } from '../canvas/types';
import type { CanvasPreviewProps, PanDrag, WindowDrag, WindowSelectionDrag, ContextMenuState } from './CanvasPreview.types';
import {
  OVERVIEW_CONTENT_INSET,
  OVERVIEW_TITLEBAR_HEIGHT,
  COMPACT_OVERVIEW_SCALE
} from './CanvasPreview.constants';
import { getWindowKey, getSafeCanvasBounds } from './CanvasPreview.helpers';
import { WindowPlaceholder } from './WindowPlaceholder';
import { CanvasContextMenu } from './CanvasContextMenu';
import { useViewportVersion } from '../hooks/useViewportVersion';
import { useCanvasTransform } from '../hooks/useCanvasTransform';
import { useWindowFrameGeometry } from '../hooks/useWindowFrameGeometry';
import { useEmbeddedWindowSync } from '../hooks/useEmbeddedWindowSync';
import { useMirrorPointerRelay } from '../hooks/useMirrorPointerRelay';
import { isEditableShortcutTarget, isPrimaryShortcut } from '../keyboard';

const CAMERA_FOCUS_ANIMATION_MS = 360;

export function CanvasPreview({
  windows,
  regions,
  safeArea,
  uiOverlayActive,
  selectedRegionId,
  selectedWindowKeys,
  embeddedWindowIds,
  onWindowsChange,
  onRegionsChange,
  onSelectRegion,
  onSelectWindowKeys,
  onCanvasHistoryCheckpoint,
  onWorkWindow,
  onWindowCommand,
  onEmbedWindow,
  onDetachEmbeddedWindow,
  onMoveEmbeddedWindow,
  onSyncDwmPreviews,
  onClearDwmPreviews,
  onRelayPointerInput,
  onScanWindows,
  canvasLaunchApps,
  onLaunchAppAt,
  onPinWindowToQuickLaunch,
  fixedPreviewSources,
  fixedPreviewFrameVersion,
  onCanvasBackgroundPointerDown,
  onApplyWindows,
  fitSignal,
  resetViewSignal,
  zoomInSignal,
  zoomOutSignal,
  actualSizeSignal,
  cameraFocusRequest,
  activityWindowHwnds,
  onAcknowledgeWindowActivity,
  onZoomChange
}: CanvasPreviewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<PanDrag | WindowDrag | WindowSelectionDrag | null>(null);
  const windowsRef = useRef(windows);
  const regionsRef = useRef(regions);
  const handledCameraFocusRequestRef = useRef(0);
  const cameraAnimationFrameRef = useRef<number | null>(null);
  const transformRef = useRef<CanvasTransform>({ offsetX: 0, offsetY: 0, scale: 1 });
  const [dragMode, setDragMode] = useState<'none' | 'pan' | 'window' | 'select-windows'>('none');
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const embeddedWindowIdSet = useMemo(() => new Set(embeddedWindowIds), [embeddedWindowIds]);
  const activityWindowHwndSet = useMemo(
    () => new Set(activityWindowHwnds.map((hwnd) => hwnd.toLowerCase())),
    [activityWindowHwnds]
  );
  const fixedPreviewSourceHwndSet = useMemo(
    () => new Set(fixedPreviewSources.map((source) => source.hwnd.toLowerCase())),
    [fixedPreviewSources]
  );
  const canvasWindowEntries = useMemo(
    () =>
      windows.flatMap((windowInfo, index) =>
        windowInfo.hwnd && fixedPreviewSourceHwndSet.has(windowInfo.hwnd.toLowerCase())
          ? []
          : [{ windowInfo, index }]
      ),
    [fixedPreviewSourceHwndSet, windows]
  );
  const canvasWindows = useMemo(
    () => canvasWindowEntries.map((entry) => entry.windowInfo),
    [canvasWindowEntries]
  );
  const shouldSuspendNativePreviews = false;

  const viewportVersion = useViewportVersion(canvasRef);

  const { transform, setTransform, fitView, getDefaultTransform } = useCanvasTransform({
    canvasRef,
    windows: canvasWindows,
    safeArea,
    fitSignal,
    resetViewSignal,
    zoomInSignal,
    zoomOutSignal,
    actualSizeSignal,
    onZoomChange
  });

  transformRef.current = transform;

  const {
    isEmbeddedWindow,
    shouldShowNativeEmbeddedWindow,
    getVisiblePreviewRects,
    getFrameScreenBounds,
    getOverviewContentScreenBounds,
    getEmbeddedContentBounds
  } = useWindowFrameGeometry({
    canvasRef,
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
    const visibleKeys = new Set(canvasWindowEntries.map(({ windowInfo, index }) => getWindowKey(windowInfo, index)));
    const nextSelectedWindowKeys = selectedWindowKeys.filter((key) => visibleKeys.has(key));
    if (nextSelectedWindowKeys.length !== selectedWindowKeys.length) {
      onSelectWindowKeys(nextSelectedWindowKeys);
    }
  }, [canvasWindowEntries, selectedWindowKeys, windows]);

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
  }, [fitSignal, resetViewSignal, zoomInSignal, zoomOutSignal, actualSizeSignal]);

  useEffect(() => {
    if (shouldSuspendNativePreviews) {
      onClearDwmPreviews();
      flushEmbeddedWindowPositions();
    }
  }, [shouldSuspendNativePreviews]);

  function getDwmPreviewWindows(windowInfo: VirtualWindowState): DwmPreviewWindow[] {
    if (!windowInfo.hwnd) {
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
      opacity: 255
    }));
  }

  function getFixedDwmPreviewWindows(): DwmPreviewWindow[] {
    const sourceById = new Map(fixedPreviewSources.map((source) => [source.id, source.hwnd]));
    if (sourceById.size === 0) {
      return [];
    }

    return Array.from(document.querySelectorAll<HTMLElement>('[data-dwm-preview-id]')).flatMap((element) => {
      const id = element.dataset.dwmPreviewId;
      const hwnd = id ? sourceById.get(id) : undefined;
      if (!id || !hwnd) {
        return [];
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 20 || rect.height <= 20) {
        return [];
      }

      return [{
        id: `fixed:${id}`,
        hwnd,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        cropX: 0,
        cropY: 0,
        cropWidth: 1,
        cropHeight: 1,
        visible: true,
        opacity: 255
      }];
    });
  }

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(() => {
      if (shouldSuspendNativePreviews) {
        onClearDwmPreviews();
        return;
      }

      const previews = [
        ...windows.flatMap((windowInfo) => (
          windowInfo.hwnd && fixedPreviewSourceHwndSet.has(windowInfo.hwnd.toLowerCase())
            ? []
            : getDwmPreviewWindows(windowInfo)
        )),
        ...getFixedDwmPreviewWindows()
      ];
      onSyncDwmPreviews(previews);
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [contextMenu, embeddedWindowIdSet, fixedPreviewFrameVersion, fixedPreviewSourceHwndSet, fixedPreviewSources, selectedRegionId, shouldSuspendNativePreviews, transform, uiOverlayActive, viewportVersion, windows]);

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

  useEffect(() => {
    function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
      return target instanceof HTMLElement && Boolean(target.closest('button, a, [role="button"]'));
    }

    function selectedWindowEntries(): Array<{ key: string; windowInfo: VirtualWindowState }> {
      const selectedKeys = new Set(selectedWindowKeys);
      return windowsRef.current.flatMap((windowInfo, index) => {
        const key = getWindowKey(windowInfo, index);
        return selectedKeys.has(key) && !(windowInfo.hwnd && fixedPreviewSourceHwndSet.has(windowInfo.hwnd.toLowerCase()))
          ? [{ key, windowInfo }]
          : [];
      });
    }

    function updateSelectedWindows(
      updater: (windowInfo: VirtualWindowState, key: string) => VirtualWindowState,
      checkpoint = true
    ): void {
      if (selectedWindowKeys.length === 0) {
        return;
      }

      const selectedKeys = new Set(selectedWindowKeys);
      if (checkpoint) {
        onCanvasHistoryCheckpoint();
      }
      const nextWindows = windowsRef.current.map((windowInfo, index) => {
        const key = getWindowKey(windowInfo, index);
        return selectedKeys.has(key) ? updater(windowInfo, key) : windowInfo;
      });
      const nextRegions = updateRegionMembership(nextWindows, regionsRef.current);
      windowsRef.current = nextWindows;
      regionsRef.current = nextRegions;
      onWindowsChange(nextWindows);
      onRegionsChange(nextRegions);
      flushEmbeddedWindowPositions();
    }

    function removeSelectedWindows(): void {
      if (selectedWindowKeys.length === 0) {
        return;
      }

      const selectedKeys = new Set(selectedWindowKeys);
      onCanvasHistoryCheckpoint();
      const nextWindows = windowsRef.current.filter((windowInfo, index) => !selectedKeys.has(getWindowKey(windowInfo, index)));
      const nextRegions = updateRegionMembership(nextWindows, regionsRef.current);
      windowsRef.current = nextWindows;
      regionsRef.current = nextRegions;
      onWindowsChange(nextWindows);
      onRegionsChange(nextRegions);
      onSelectWindowKeys([]);
      setContextMenu(null);
    }

    function handleCanvasShortcuts(event: KeyboardEvent): void {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      if (event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey && !isInteractiveShortcutTarget(event.target)) {
        event.preventDefault();
        setIsSpacePanning(true);
        return;
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.startsWith('Arrow')) {
        const delta = event.shiftKey ? 50 : 10;
        const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
        const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
        if (dx !== 0 || dy !== 0) {
          event.preventDefault();
          updateSelectedWindows((windowInfo) => ({
            ...windowInfo,
            virtualX: Math.round(windowInfo.virtualX + dx),
            virtualY: Math.round(windowInfo.virtualY + dy),
            isDirty: true
          }), !event.repeat);
        }
        return;
      }

      if (isPrimaryShortcut(event) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelectWindowKeys(
          windowsRef.current.flatMap((windowInfo, index) =>
            windowInfo.hwnd && fixedPreviewSourceHwndSet.has(windowInfo.hwnd.toLowerCase())
              ? []
              : [getWindowKey(windowInfo, index)]
          )
        );
        setContextMenu(null);
        return;
      }

      const selectedEntries = selectedWindowEntries();
      const primarySelection = selectedEntries[0]?.windowInfo;
      if (!primarySelection) {
        return;
      }

      if (isPrimaryShortcut(event) && event.key === 'Enter') {
        event.preventDefault();
        zoomToWindowNode(primarySelection);
        return;
      }

      if (isPrimaryShortcut(event) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (event.repeat) {
          return;
        }
        if (isEmbeddedWindow(primarySelection)) {
          detachEmbeddedWindow(primarySelection);
        } else {
          embedWindow(primarySelection);
        }
        return;
      }

      if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Enter') {
        event.preventDefault();
        runWindowCommand(primarySelection, 'focus');
        return;
      }

      if (!event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        removeSelectedWindows();
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (event.key === ' ') {
        setIsSpacePanning(false);
      }
    }

    function handleBlur(): void {
      setIsSpacePanning(false);
    }

    window.addEventListener('keydown', handleCanvasShortcuts);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleCanvasShortcuts);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  });

  function normalizeSelectionRect(startX: number, startY: number, endX: number, endY: number): { x: number; y: number; width: number; height: number } {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    return {
      x,
      y,
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY)
    };
  }

  function windowIntersectsSelection(windowInfo: VirtualWindowState, rect: { x: number; y: number; width: number; height: number }): boolean {
    return (
      windowInfo.virtualX < rect.x + rect.width &&
      windowInfo.virtualX + windowInfo.width > rect.x &&
      windowInfo.virtualY < rect.y + rect.height &&
      windowInfo.virtualY + windowInfo.height > rect.y
    );
  }

  function startPanDrag(event: React.PointerEvent<HTMLElement>, captureTarget: HTMLElement): void {
    dragRef.current = {
      type: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY
    };
    setDragMode('pan');
    captureTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return;
    }

    cancelCameraAnimation();
    setContextMenu(null);
    onSelectRegion(null);
    onCanvasBackgroundPointerDown();
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;

    if (event.ctrlKey && !isSpacePanning) {
      const worldPoint = screenToWorld(screenX, screenY, transform);
      dragRef.current = {
        type: 'select-windows',
        startWorldX: worldPoint.x,
        startWorldY: worldPoint.y
      };
      setSelectionRect({ x: worldPoint.x, y: worldPoint.y, width: 0, height: 0 });
      setDragMode('select-windows');
    } else {
      onSelectWindowKeys([]);
      startPanDrag(event, event.currentTarget);
    }
  }

  function handleWindowPointerDown(
    event: React.PointerEvent<HTMLElement>,
    windowInfo: VirtualWindowState,
    key: string
  ): void {
    if (windowInfo.hwnd) {
      onAcknowledgeWindowActivity(windowInfo.hwnd);
    }
    if (event.button !== 0) {
      return;
    }

    cancelCameraAnimation();
    setContextMenu(null);
    event.stopPropagation();
    if (isSpacePanning) {
      const canvas = canvasRef.current;
      if (canvas) {
        startPanDrag(event, canvas);
      }
      return;
    }

    const currentSelection = selectedWindowKeys.includes(key) ? selectedWindowKeys : [key];
    const nextSelection = event.ctrlKey
      ? selectedWindowKeys.includes(key)
        ? selectedWindowKeys.filter((selectedKey) => selectedKey !== key)
        : [...selectedWindowKeys, key]
      : currentSelection;
    const dragSelection = nextSelection.length > 0 ? nextSelection : [key];
    onSelectWindowKeys(dragSelection);
    dragRef.current = {
      type: 'window',
      key,
      startX: event.clientX,
      startY: event.clientY,
      virtualX: windowInfo.virtualX,
      virtualY: windowInfo.virtualY,
      moved: false,
      checkpointed: false,
      groupPositions: windowsRef.current
        .map((candidate, index) => ({
          key: getWindowKey(candidate, index),
          virtualX: candidate.virtualX,
          virtualY: candidate.virtualY
        }))
        .filter((candidate) => dragSelection.includes(candidate.key))
    };
    setDragMode('window');
    event.currentTarget.setPointerCapture(event.pointerId);
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

    if (drag.type === 'select-windows') {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const worldPoint = screenToWorld(event.clientX - rect.left, event.clientY - rect.top, transform);
      setSelectionRect(normalizeSelectionRect(drag.startWorldX, drag.startWorldY, worldPoint.x, worldPoint.y));
      return;
    }

    const deltaX = (event.clientX - drag.startX) / transform.scale;
    const deltaY = (event.clientY - drag.startY) / transform.scale;

    if (drag.type === 'window') {
      const hasMoved = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
      if (hasMoved && !drag.checkpointed) {
        onCanvasHistoryCheckpoint();
        drag.checkpointed = true;
      }
      drag.moved = hasMoved;
      if (!hasMoved) {
        return;
      }
      const groupPositions = new Map(drag.groupPositions.map((item) => [item.key, item]));
      const nextWindows = windowsRef.current.map((windowInfo, index) => {
        const startingPosition = groupPositions.get(getWindowKey(windowInfo, index));
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
      onWindowsChange(nextWindows);
      return;
    }
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;

    if (drag?.type === 'select-windows' && selectionRect) {
      const nextSelectedKeys = windowsRef.current.flatMap((windowInfo, index) =>
        windowInfo.hwnd && fixedPreviewSourceHwndSet.has(windowInfo.hwnd.toLowerCase())
          ? []
          : windowIntersectsSelection(windowInfo, selectionRect)
            ? [getWindowKey(windowInfo, index)]
            : []
      );
      onSelectWindowKeys(nextSelectedKeys);
    } else if (drag?.type === 'window') {
      onRegionsChange(updateRegionMembership(windowsRef.current, regionsRef.current));
      flushEmbeddedWindowPositions();
    }

    dragRef.current = null;
    setSelectionRect(null);
    setDragMode('none');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    cancelCameraAnimation();
    event.preventDefault();
    if (event.shiftKey) {
      setTransform((current) => ({
        ...current,
        offsetX: current.offsetX - event.deltaY
      }));
      return;
    }

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
    onCanvasHistoryCheckpoint();
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
    onCanvasHistoryCheckpoint();
    const nextWindows = windowsRef.current.filter((windowInfo, index) => getWindowKey(windowInfo, index) !== key);
    windowsRef.current = nextWindows;
    onWindowsChange(nextWindows);
    onRegionsChange(updateRegionMembership(nextWindows, regionsRef.current));
  }

  function runWindowCommand(windowInfo: VirtualWindowState, command: WindowCommand): void {
    if (!windowInfo.hwnd) {
      return;
    }

    onAcknowledgeWindowActivity(windowInfo.hwnd);
    onWindowCommand(windowInfo.hwnd, command);
  }

  function workInWindow(windowInfo: VirtualWindowState): void {
    if (!windowInfo.hwnd) {
      return;
    }

    onAcknowledgeWindowActivity(windowInfo.hwnd);
    onWorkWindow(windowInfo.hwnd);
  }

  function embedWindow(windowInfo: VirtualWindowState): void {
    if (!windowInfo.hwnd) {
      return;
    }

    cancelCameraAnimation();
    onEmbedWindow(windowInfo, getEmbeddedContentBounds(windowInfo, true, transformRef.current));
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

  const contextWindow =
    contextMenu?.type === 'window'
      ? canvasWindowEntries.find(({ windowInfo, index }) => getWindowKey(windowInfo, index) === contextMenu.key)?.windowInfo
      : null;
  const selectedWindowKeySet = new Set(selectedWindowKeys);

  return (
    <section className="canvas-preview">
      <div
        ref={canvasRef}
        className={`canvas-surface ${dragMode === 'pan' ? 'dragging' : ''} ${dragMode !== 'none' && dragMode !== 'pan' ? 'moving-window' : ''} ${isSpacePanning ? 'space-panning' : ''}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={handleCanvasContextMenu}
      >
        {canvasWindowEntries.length === 0 ? (
          <div className="canvas-empty">
            <strong>Scan Windows to start.</strong>
            <span>Drag windows to arrange them. Ctrl+Drag selects multiple windows.</span>
          </div>
        ) : (
          canvasWindowEntries.map(({ windowInfo, index }) => {
            const key = getWindowKey(windowInfo, index);
            const frame = getFrameScreenBounds(windowInfo);
            const isEmbedded = isEmbeddedWindow(windowInfo);
            const hasActivity = Boolean(
              windowInfo.hwnd && activityWindowHwndSet.has(windowInfo.hwnd.toLowerCase())
            );
            const isNativeEmbeddedVisible = shouldShowNativeEmbeddedWindow(windowInfo);
            const isCompactOverview = !isEmbedded && transform.scale < COMPACT_OVERVIEW_SCALE;
            const isSelected = selectedWindowKeySet.has(key);
            return (
              <article
                className={`virtual-window overview-window ${isCompactOverview ? 'compact-overview-window' : ''} ${windowInfo.isHelper ? 'helper-window' : ''} ${windowInfo.isDirty ? 'dirty-window' : ''} ${
                  isEmbedded ? 'embedded-window' : ''
                } ${isEmbedded && !isNativeEmbeddedVisible ? 'embedded-overview-window' : ''} ${hasActivity ? 'activity-window' : ''} ${isSelected ? 'selected-window' : ''}`}
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
                        <button
                          title={isEmbedded ? 'Detach interactive control' : 'Attach interactive control'}
                          onClick={() => isEmbedded ? detachEmbeddedWindow(windowInfo) : embedWindow(windowInfo)}
                        >
                          <MousePointer2 size={11} />
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
                <div
                  className={`virtual-content ${isEmbedded && isNativeEmbeddedVisible ? 'embedded-content' : ''}`}
                  role="application"
                  tabIndex={0}
                  aria-label={`Control ${windowInfo.title}`}
                  onPointerDown={(event) => {
                    if (windowInfo.hwnd) {
                      onAcknowledgeWindowActivity(windowInfo.hwnd);
                    }
                    handleMirrorPointerDown(event, windowInfo);
                  }}
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

        {selectionRect ? (
          <div
            className="window-selection-box"
            style={{
              left: worldToScreen(selectionRect.x, selectionRect.y, transform).x,
              top: worldToScreen(selectionRect.x, selectionRect.y, transform).y,
              width: selectionRect.width * transform.scale,
              height: selectionRect.height * transform.scale
            }}
          />
        ) : null}

        {contextMenu ? (
          <CanvasContextMenu
            contextMenu={contextMenu}
            contextWindow={contextWindow ?? null}
            canvasLaunchApps={canvasLaunchApps}
            onClose={() => setContextMenu(null)}
            onScanWindows={onScanWindows}
            onFitView={fitView}
            onResetView={() => setTransform(getDefaultTransform())}
            onLaunchAppAt={onLaunchAppAt}
            onZoomToWindow={zoomToWindowNode}
            onWorkInWindow={workInWindow}
            onPinToQuickLaunch={onPinWindowToQuickLaunch}
            onCloseWindow={(windowInfo) => runWindowCommand(windowInfo, 'close')}
            onRemoveWindowFromCanvas={removeWindowFromCanvas}
          />
        ) : null}
      </div>
    </section>
  );
}
