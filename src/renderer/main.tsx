import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { X } from 'lucide-react';
import type { DetectedWindow, DockApp, QuickLaunch, SavedWorkspace } from '../shared/types';
import { updateRegionMembership } from './canvas/regions';
import {
  createInitialVirtualLayout,
  findExistingActivityTarget,
  refreshVirtualWindowMetadata,
  toVirtualWindows
} from './canvas/windows';
import type { TemplateRegion, VirtualWindowState } from './canvas/types';
import {
  virtualWindowToDetected,
  restoreResultText,
  processMatchesDockApp,
  placeDetectedWindowsNearSource,
  placeDetectedWindowsAtPoint
} from './canvas/layout-helpers';
import { useWindowControlActions } from './hooks/useWindowControlActions';
import { CanvasPreview } from './components/CanvasPreview';
import { getWindowKey } from './components/CanvasPreview.helpers';
import { Dock } from './components/Dock';
import { BrandMenu } from './components/BrandMenu';
import { ViewControls } from './components/ViewControls';
import { StatusPanel } from './components/StatusPanel';
import { WorkspaceList } from './components/WorkspaceList';
import { QuickLaunchPanel, type QuickLaunchPanelLayout } from './components/QuickLaunchPanel';
import { defaultDockApps } from './dock/apps';
import { compareDockAppsByName, getDockAppIdentityKey, uniqueDockApps } from './dock/identity';
import { isEditableShortcutTarget, isPrimaryShortcut } from './keyboard';
import './styles/base.css';
import './styles/theme.css';
import './styles/chrome.css';

const AUTO_WINDOW_SCAN_INTERVAL_MS = 700;
const INTERACTION_SCAN_DELAYS_MS = [120, 400, 900, 1600] as const;
const DOCK_LAUNCH_SCAN_DELAYS_MS = [100, 250, 500, 900, 1500, 2400] as const;
const MAX_CANVAS_HISTORY = 80;
const QUICK_LAUNCH_PANEL_LAYOUT_STORAGE_KEY = 'infinitedesk.quickLaunchPanelLayout';
const DEFAULT_QUICK_LAUNCH_PANEL_LAYOUT: QuickLaunchPanelLayout = {
  side: 'right',
  y: 9999,
  width: 300,
  height: 260
};

type CanvasSnapshot = {
  windows: VirtualWindowState[];
  regions: TemplateRegion[];
  previewWorkspace: SavedWorkspace | null;
  selectedRegionId: string | null;
};

type LaunchPlacementPoint = { x: number; y: number };

function readQuickLaunchPanelLayout(): QuickLaunchPanelLayout {
  try {
    const raw = window.localStorage.getItem(QUICK_LAUNCH_PANEL_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_QUICK_LAUNCH_PANEL_LAYOUT;
    }

    const parsed = JSON.parse(raw) as Partial<QuickLaunchPanelLayout>;
    return {
      side: parsed.side === 'left' ? 'left' : 'right',
      y: Number.isFinite(parsed.y) ? parsed.y! : DEFAULT_QUICK_LAUNCH_PANEL_LAYOUT.y,
      width: Number.isFinite(parsed.width) ? parsed.width! : DEFAULT_QUICK_LAUNCH_PANEL_LAYOUT.width,
      height: Number.isFinite(parsed.height) ? parsed.height! : DEFAULT_QUICK_LAUNCH_PANEL_LAYOUT.height
    };
  } catch {
    return DEFAULT_QUICK_LAUNCH_PANEL_LAYOUT;
  }
}

function App(): React.JSX.Element {
  const [windows, setWindows] = useState<DetectedWindow[]>([]);
  const [virtualWindows, setVirtualWindows] = useState<VirtualWindowState[]>([]);
  const [initialVirtualWindows, setInitialVirtualWindows] = useState<VirtualWindowState[]>([]);
  const [regions, setRegions] = useState<TemplateRegion[]>([]);
  const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isBrandMenuOpen, setIsBrandMenuOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState('Scan Windows to start. Drag windows to arrange them. Ctrl+Drag selects multiple windows.');
  const [error, setError] = useState<string | null>(null);
  const [previewWorkspace, setPreviewWorkspace] = useState<SavedWorkspace | null>(null);
  const [themeMode, setThemeMode] = useState<'mist' | 'graphite'>('mist');
  const [fitSignal, setFitSignal] = useState(0);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [zoomInSignal, setZoomInSignal] = useState(0);
  const [zoomOutSignal, setZoomOutSignal] = useState(0);
  const [actualSizeSignal, setActualSizeSignal] = useState(0);
  const [cameraFocusRequest, setCameraFocusRequest] = useState<{ id: number; hwnd: string } | null>(null);
  const [activityWindowHwnds, setActivityWindowHwnds] = useState<string[]>([]);
  const [zoomScale, setZoomScale] = useState(1);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [localDockApps, setLocalDockApps] = useState<DockApp[]>([]);
  const [userPinnedDockApps, setUserPinnedDockApps] = useState<DockApp[]>([]);
  const [unpinnedDefaultDockAppIds, setUnpinnedDefaultDockAppIds] = useState<string[]>([]);
  const [quickLaunches, setQuickLaunches] = useState<QuickLaunch[]>([]);
  const [quickLaunchPanelLayout, setQuickLaunchPanelLayout] = useState<QuickLaunchPanelLayout>(readQuickLaunchPanelLayout);
  const [quickLaunchPreviewFrameVersion, setQuickLaunchPreviewFrameVersion] = useState(0);
  const [isLoadingDockApps, setIsLoadingDockApps] = useState(false);
  const [isDockOverlayActive, setIsDockOverlayActive] = useState(false);
  const [closeDockSignal, setCloseDockSignal] = useState(0);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedWindowKeys, setSelectedWindowKeys] = useState<string[]>([]);
  const [overlayModeEnabled, setOverlayModeEnabled] = useState(false);
  const [embeddedWindowIds, setEmbeddedWindowIds] = useState<string[]>([]);
  const [isViewControlsExpanded, setIsViewControlsExpanded] = useState(false);
  const virtualWindowsRef = useRef<VirtualWindowState[]>([]);
  const initialVirtualWindowsRef = useRef<VirtualWindowState[]>([]);
  const regionsRef = useRef<TemplateRegion[]>([]);
  const previewWorkspaceRef = useRef<SavedWorkspace | null>(null);
  const selectedRegionIdRef = useRef<string | null>(null);
  const undoStackRef = useRef<CanvasSnapshot[]>([]);
  const redoStackRef = useRef<CanvasSnapshot[]>([]);
  const autoScanInFlightRef = useRef(false);
  const autoScanTimersRef = useRef<number[]>([]);
  const latestInteractionSourceRef = useRef('');
  const interactionScanGenerationRef = useRef(0);
  const cameraFocusRequestIdRef = useRef(0);
  const hasCompletedInitialScanRef = useRef(false);

  const canvasLabel = previewWorkspace ? `Previewing workspace: ${previewWorkspace.name}` : `${virtualWindows.length} windows`;
  const dirtyCount = virtualWindows.filter((windowInfo) => windowInfo.isDirty).length;
  const restorableCount = useMemo(() => windows.filter((windowInfo) => windowInfo.isRestorable && !windowInfo.isInternal).length, [windows]);
  const defaultDockAppIdSet = useMemo(() => new Set(defaultDockApps.map((dockApp) => dockApp.id)), []);
  const visibleDefaultDockApps = useMemo(
    () => defaultDockApps.filter((dockApp) => !unpinnedDefaultDockAppIds.includes(dockApp.id)),
    [unpinnedDefaultDockAppIds]
  );
  const pinnedDockApps = useMemo(() => {
    return uniqueDockApps([...visibleDefaultDockApps, ...userPinnedDockApps]);
  }, [userPinnedDockApps, visibleDefaultDockApps]);
  const dockApps = useMemo(() => {
    const pinnedKeys = new Set(pinnedDockApps.map(getDockAppIdentityKey));
    const remainingApps = uniqueDockApps([...localDockApps, ...defaultDockApps])
      .filter((dockApp) => !pinnedKeys.has(getDockAppIdentityKey(dockApp)))
      .sort(compareDockAppsByName);

    return [...pinnedDockApps, ...remainingApps];
  }, [localDockApps, pinnedDockApps]);
  const quickLaunchPreviewSources = useMemo(() => {
    return quickLaunches.flatMap((quickLaunch) => {
      const sourceByHwnd = quickLaunch.sourceHwnd
        ? windows.find(
            (windowInfo) =>
              windowInfo.hwnd.toLowerCase() === quickLaunch.sourceHwnd!.toLowerCase() &&
              !windowInfo.isInternal
          )
        : undefined;
      const sourceByTitle = quickLaunch.sourceTitle
        ? windows.find(
            (windowInfo) =>
              windowInfo.title === quickLaunch.sourceTitle &&
              processMatchesDockApp(windowInfo, quickLaunch.app) &&
              !windowInfo.isInternal
          )
        : undefined;
      const sourceByApp = windows.find(
        (windowInfo) => processMatchesDockApp(windowInfo, quickLaunch.app) && !windowInfo.isInternal
      );
      const source = sourceByHwnd || sourceByTitle || sourceByApp;
      return source?.hwnd ? [{ id: quickLaunch.id, hwnd: source.hwnd }] : [];
    });
  }, [quickLaunches, windows]);
  const quickLaunchPreviewSourceIds = useMemo(
    () => new Set(quickLaunchPreviewSources.map((source) => source.id)),
    [quickLaunchPreviewSources]
  );
  const runningDockWindows = useMemo(() => {
    const canvasWindowsByHwnd = new Map(
      virtualWindows
        .filter((windowInfo) => windowInfo.hwnd)
        .map((windowInfo) => [windowInfo.hwnd!.toLowerCase(), windowInfo])
    );

    return windows
      .filter((windowInfo) => !windowInfo.isInternal && windowInfo.hwnd)
      .map<VirtualWindowState>((windowInfo) => {
        const existingCanvasWindow = canvasWindowsByHwnd.get(windowInfo.hwnd.toLowerCase());
        if (existingCanvasWindow) {
          return {
            ...existingCanvasWindow,
            title: windowInfo.title,
            processName: windowInfo.processName,
            statusReason: windowInfo.statusReason
          };
        }

        return {
          hwnd: windowInfo.hwnd,
          title: windowInfo.title,
          processName: windowInfo.processName,
          realX: windowInfo.x ?? 0,
          realY: windowInfo.y ?? 0,
          virtualX: windowInfo.x ?? 0,
          virtualY: windowInfo.y ?? 0,
          width: windowInfo.width ?? 1,
          height: windowInfo.height ?? 1,
          initialVirtualX: windowInfo.x ?? 0,
          initialVirtualY: windowInfo.y ?? 0,
          isDirty: false,
          statusReason: windowInfo.statusReason,
          isHelper: !windowInfo.isRestorable || windowInfo.isIgnored
        };
      });
  }, [virtualWindows, windows]);
  const canvasSafeArea = useMemo(
    () => ({
      left: 16,
      top: 16,
      right: 16,
      bottom: 16
    }),
    []
  );

  function cloneCanvasSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
    return {
      windows: snapshot.windows.map((windowInfo) => ({ ...windowInfo })),
      regions: snapshot.regions.map((region) => ({ ...region, windowIds: [...region.windowIds] })),
      previewWorkspace: snapshot.previewWorkspace,
      selectedRegionId: snapshot.selectedRegionId
    };
  }

  function getCanvasSnapshot(): CanvasSnapshot {
    return cloneCanvasSnapshot({
      windows: virtualWindowsRef.current,
      regions: regionsRef.current,
      previewWorkspace: previewWorkspaceRef.current,
      selectedRegionId: selectedRegionIdRef.current
    });
  }

  function snapshotsMatch(left: CanvasSnapshot, right: CanvasSnapshot): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function setCanvasWindows(nextWindows: VirtualWindowState[]): void {
    virtualWindowsRef.current = nextWindows;
    setVirtualWindows(nextWindows);
  }

  function setCanvasRegions(nextRegions: TemplateRegion[]): void {
    regionsRef.current = nextRegions;
    setRegions(nextRegions);
  }

  function setCanvasPreviewWorkspace(nextWorkspace: SavedWorkspace | null): void {
    previewWorkspaceRef.current = nextWorkspace;
    setPreviewWorkspace(nextWorkspace);
  }

  function setCanvasSelectedRegionId(nextRegionId: string | null): void {
    selectedRegionIdRef.current = nextRegionId;
    setSelectedRegionId(nextRegionId);
  }

  function clearCanvasHistory(): void {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }

  function checkpointCanvasHistory(): void {
    const snapshot = getCanvasSnapshot();
    const latest = undoStackRef.current[undoStackRef.current.length - 1];
    if (latest && snapshotsMatch(latest, snapshot)) {
      return;
    }

    undoStackRef.current = [...undoStackRef.current, snapshot].slice(-MAX_CANVAS_HISTORY);
    redoStackRef.current = [];
  }

  function restoreCanvasSnapshot(snapshot: CanvasSnapshot): void {
    const restored = cloneCanvasSnapshot(snapshot);
    setCanvasWindows(restored.windows);
    setCanvasRegions(restored.regions);
    setCanvasPreviewWorkspace(restored.previewWorkspace);
    setCanvasSelectedRegionId(restored.selectedRegionId);
    setActivityWindowHwnds([]);
  }

  function undoCanvasEdit(): void {
    const previous = undoStackRef.current.pop();
    if (!previous) {
      setMessage('No canvas edit to undo.');
      return;
    }

    redoStackRef.current = [...redoStackRef.current, getCanvasSnapshot()].slice(-MAX_CANVAS_HISTORY);
    restoreCanvasSnapshot(previous);
    setError(null);
    setMessage('Undid the last canvas edit.');
  }

  function redoCanvasEdit(): void {
    const next = redoStackRef.current.pop();
    if (!next) {
      setMessage('No canvas edit to redo.');
      return;
    }

    undoStackRef.current = [...undoStackRef.current, getCanvasSnapshot()].slice(-MAX_CANVAS_HISTORY);
    restoreCanvasSnapshot(next);
    setError(null);
    setMessage('Redid the canvas edit.');
  }

  function pruneCanvasHistoryForClosedWindow(normalizedHwnd: string): void {
    const pruneSnapshot = (snapshot: CanvasSnapshot): CanvasSnapshot => {
      const nextWindows = snapshot.windows.filter((windowInfo) => windowInfo.hwnd?.toLowerCase() !== normalizedHwnd);
      return {
        ...snapshot,
        windows: nextWindows,
        regions: updateRegionMembership(nextWindows, snapshot.regions)
      };
    };

    undoStackRef.current = undoStackRef.current.map(pruneSnapshot);
    redoStackRef.current = redoStackRef.current.map(pruneSnapshot);
  }

  const {
    workInRealWindow,
    controlRealWindow,
    embedRealWindow,
    relayPointerInput,
    detachRealWindow,
    detachAllInteractiveWindows,
    moveEmbeddedWindow,
    syncDwmPreviews,
    clearDwmPreviews,
    toggleOverlayMode,
    quitInfiniteDesk
  } = useWindowControlActions({
    embeddedWindowIds,
    setEmbeddedWindowIds,
    overlayModeEnabled,
    setOverlayModeEnabled,
    setError,
    setMessage,
    setIsBrandMenuOpen
  });

  async function loadWorkspaces(): Promise<void> {
    const loaded = await window.infiniteDesk.listWorkspaces();
    setWorkspaces(loaded);
  }

  async function loadDockApps(): Promise<void> {
    setIsLoadingDockApps(true);
    try {
      const [loaded, pinned, unpinnedDefaultIds] = await Promise.all([
        window.infiniteDesk.listDockApps(),
        window.infiniteDesk.listPinnedDockApps(),
        window.infiniteDesk.listUnpinnedDefaultDockApps()
      ]);
      setLocalDockApps(loaded);
      setUserPinnedDockApps(pinned);
      setUnpinnedDefaultDockAppIds(unpinnedDefaultIds);
    } catch (dockError) {
      setError(`Could not load local apps: ${(dockError as Error).message}`);
    } finally {
      setIsLoadingDockApps(false);
    }
  }

  async function loadQuickLaunches(): Promise<void> {
    try {
      setQuickLaunches(await window.infiniteDesk.listQuickLaunches());
    } catch (quickLaunchError) {
      setError(`Could not load Quick Launches: ${(quickLaunchError as Error).message}`);
    }
  }

  async function pinDockApp(dockApp: DockApp): Promise<void> {
    if (!dockApp.executablePath) {
      setError(`${dockApp.name} cannot be pinned because it has no launch target.`);
      return;
    }

    setError(null);
    try {
      if (defaultDockAppIdSet.has(dockApp.id)) {
        const unpinnedDefaultIds = await window.infiniteDesk.pinDefaultDockApp(dockApp.id);
        setUnpinnedDefaultDockAppIds(unpinnedDefaultIds);
        setMessage(`Pinned ${dockApp.name} to the Dock.`);
        return;
      }

      const pinned = await window.infiniteDesk.pinDockApp(dockApp);
      setUserPinnedDockApps(pinned);
      setMessage(`Pinned ${dockApp.name} to the Dock.`);
    } catch (pinError) {
      setError((pinError as Error).message);
    }
  }

  async function unpinDockApp(dockApp: DockApp): Promise<void> {
    setError(null);
    try {
      if (defaultDockAppIdSet.has(dockApp.id)) {
        const unpinnedDefaultIds = await window.infiniteDesk.unpinDefaultDockApp(dockApp.id);
        setUnpinnedDefaultDockAppIds(unpinnedDefaultIds);
        setMessage(`Removed ${dockApp.name} from the Dock.`);
        return;
      }

      const pinned = await window.infiniteDesk.unpinDockApp(dockApp.id);
      setUserPinnedDockApps(pinned);
      setMessage(`Removed ${dockApp.name} from the Dock.`);
    } catch (unpinError) {
      setError((unpinError as Error).message);
    }
  }

  async function pinWindowToQuickLaunch(windowInfo: VirtualWindowState): Promise<void> {
    const detectedWindow = virtualWindowToDetected(windowInfo);
    const matchingApp = dockApps.find((dockApp) => processMatchesDockApp(detectedWindow, dockApp));
    if (!matchingApp) {
      setError(`${windowInfo.processName} cannot be pinned to Quick Launch because its app target was not found.`);
      return;
    }

    setError(null);
    try {
      const nextQuickLaunches = await window.infiniteDesk.createQuickLaunch({
        name: matchingApp.name,
        app: matchingApp,
        x: windowInfo.virtualX,
        y: windowInfo.virtualY,
        sourceHwnd: windowInfo.hwnd,
        sourceTitle: windowInfo.title,
        processName: windowInfo.processName
      });
      setQuickLaunches(nextQuickLaunches);
      setMessage(`Pinned ${matchingApp.name} to Quick Launch.`);
    } catch (quickLaunchError) {
      setError((quickLaunchError as Error).message);
    }
  }

  async function deleteQuickLaunch(quickLaunch: QuickLaunch): Promise<void> {
    setError(null);
    try {
      setQuickLaunches(await window.infiniteDesk.deleteQuickLaunch(quickLaunch.id));
      setMessage(`Removed ${quickLaunch.name} from Quick Launch.`);
    } catch (quickLaunchError) {
      setError((quickLaunchError as Error).message);
    }
  }

  function launchQuickLaunch(quickLaunch: QuickLaunch): void {
    void launchDockApp(quickLaunch.app, { x: quickLaunch.x, y: quickLaunch.y });
  }

  function bumpQuickLaunchPreviewFrame(): void {
    setQuickLaunchPreviewFrameVersion((value) => value + 1);
  }

  function updateQuickLaunchPanelLayout(layout: QuickLaunchPanelLayout): void {
    setQuickLaunchPanelLayout(layout);
    bumpQuickLaunchPreviewFrame();
    try {
      window.localStorage.setItem(QUICK_LAUNCH_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Layout persistence is best-effort; the panel still works without it.
    }
  }

  function loadVirtualLayout(
    nextWindows: VirtualWindowState[],
    workspace: SavedWorkspace | null = null
  ): void {
    const normalizedWindows = nextWindows.map((windowInfo) => ({
      ...windowInfo,
      initialVirtualX: windowInfo.virtualX,
      initialVirtualY: windowInfo.virtualY,
      isDirty: false
    }));
    setCanvasWindows(normalizedWindows);
    setInitialVirtualWindows(normalizedWindows);
    setCanvasRegions([]);
    setCanvasSelectedRegionId(null);
    setSelectedWindowKeys([]);
    setCanvasPreviewWorkspace(workspace);
    setActivityWindowHwnds([]);
    clearCanvasHistory();
    setFitSignal((value) => value + 1);
  }

  async function scanWindows(): Promise<void> {
    setIsScanning(true);
    setError(null);
    try {
      if (embeddedWindowIds.length > 0) {
        const detached = await detachAllInteractiveWindows();
        if (!detached) {
          return;
        }
      }
      const detected = await window.infiniteDesk.scanWindows();
      const layout = createInitialVirtualLayout(detected);
      setWindows(detected);
      loadVirtualLayout(layout);
      setMessage(`Scanned ${detected.length} windows. ${layout.length} are on the canvas.`);
    } catch (scanError) {
      setError((scanError as Error).message);
    } finally {
      hasCompletedInitialScanRef.current = true;
      setIsScanning(false);
      setIsBrandMenuOpen(false);
    }
  }

  function focusCameraOnWindow(hwnd: string | undefined): void {
    if (!hwnd) {
      return;
    }

    cameraFocusRequestIdRef.current += 1;
    setCameraFocusRequest({ id: cameraFocusRequestIdRef.current, hwnd });
  }

  function selectWindowFromDock(windowInfo: VirtualWindowState, index: number): void {
    const canvasIndex = windowInfo.hwnd
      ? virtualWindowsRef.current.findIndex((candidate) => candidate.hwnd?.toLowerCase() === windowInfo.hwnd!.toLowerCase())
      : index;
    const canvasWindow = canvasIndex >= 0 ? virtualWindowsRef.current[canvasIndex] : null;
    if (!canvasWindow) {
      if (windowInfo.hwnd) {
        void controlRealWindow(windowInfo.hwnd, 'focus');
      }
      setSelectedWindowKeys([]);
      setMessage(`${windowInfo.title || windowInfo.processName} is running but is not on the canvas.`);
      return;
    }

    setSelectedWindowKeys([getWindowKey(canvasWindow, canvasIndex)]);
    setCanvasSelectedRegionId(null);
    setIsBrandMenuOpen(false);
    focusCameraOnWindow(canvasWindow.hwnd);
  }

  function zoomWindowFromDock(windowInfo: VirtualWindowState, index: number): void {
    selectWindowFromDock(windowInfo, index);
  }

  function markWindowActivity(hwnds: string[]): void {
    const normalizedHwnds = hwnds.filter(Boolean).map((hwnd) => hwnd.toLowerCase());
    if (normalizedHwnds.length === 0) {
      return;
    }
    setActivityWindowHwnds((current) => Array.from(new Set([...current, ...normalizedHwnds])));
  }

  function acknowledgeWindowActivity(hwnd: string): void {
    const normalizedHwnd = hwnd.toLowerCase();
    setActivityWindowHwnds((current) => current.filter((candidate) => candidate !== normalizedHwnd));
  }

  async function scanAfterLaunch(dockApp: DockApp, placementPoint?: LaunchPlacementPoint): Promise<void> {
    const startedAt = Date.now();
    const hwndsAtLaunch = new Set(
      virtualWindowsRef.current.flatMap((windowInfo) => (windowInfo.hwnd ? [windowInfo.hwnd.toLowerCase()] : []))
    );

    for (const targetDelay of DOCK_LAUNCH_SCAN_DELAYS_MS) {
      const remainingDelay = targetDelay - (Date.now() - startedAt);
      if (remainingDelay > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingDelay));
      }

      await scanForNewWindows('', dockApp, placementPoint);
      const matchingNewWindow = virtualWindowsRef.current.find(
        (windowInfo) =>
          processMatchesDockApp(virtualWindowToDetected(windowInfo), dockApp) &&
          Boolean(windowInfo.hwnd) &&
          !hwndsAtLaunch.has(windowInfo.hwnd!.toLowerCase())
      );
      if (matchingNewWindow) {
        focusCameraOnWindow(matchingNewWindow?.hwnd);
        return;
      }

      if (targetDelay !== DOCK_LAUNCH_SCAN_DELAYS_MS[DOCK_LAUNCH_SCAN_DELAYS_MS.length - 1]) {
        continue;
      }

      const existingMatchingWindow = virtualWindowsRef.current.find((windowInfo) =>
        processMatchesDockApp(virtualWindowToDetected(windowInfo), dockApp)
      );
      if (existingMatchingWindow) {
        focusCameraOnWindow(existingMatchingWindow.hwnd);
        return;
      }
    }

    setMessage(`Launched ${dockApp.name}, but its window is still starting.`);
  }

  async function launchDockApp(dockApp: DockApp, placementPoint?: LaunchPlacementPoint): Promise<void> {
    setLaunchingAppId(dockApp.id);
    setError(null);
    try {
      const result = await window.infiniteDesk.launchApp(dockApp.id);
      if (!result.success) {
        setError(result.error || `${dockApp.name} could not be launched.`);
        return;
      }

      setMessage(`Launching ${dockApp.name}...`);
      await scanAfterLaunch(dockApp, placementPoint);
    } catch (launchError) {
      setError((launchError as Error).message);
    } finally {
      setLaunchingAppId(null);
    }
  }

  async function applyWindows(targetWindows: VirtualWindowState[]): Promise<void> {
    if (targetWindows.length === 0) {
      setError('There are no windows to apply.');
      return;
    }

    setError(null);
    try {
      const result = await window.infiniteDesk.applyLayout({
        windows: targetWindows.map(virtualWindowToDetected)
      });
      setMessage(`Applied layout. ${restoreResultText(result)}`);
    } catch (applyError) {
      setError((applyError as Error).message);
    }
  }

  async function applyCanvasLayout(): Promise<void> {
    await applyWindows(virtualWindows);
    setIsBrandMenuOpen(false);
  }

  async function scanForNewWindows(sourceHwnd: string, preferredDockApp?: DockApp, placementPoint?: LaunchPlacementPoint): Promise<number> {
    if (autoScanInFlightRef.current) {
      return 0;
    }

    autoScanInFlightRef.current = true;
    try {
      const detected = await window.infiniteDesk.scanWindows();

      const currentWindows = virtualWindowsRef.current;
      const metadataRefresh = refreshVirtualWindowMetadata(currentWindows, detected);
      const refreshedWindows = metadataRefresh.windows;
      const knownHwnds = new Set(
        currentWindows.flatMap((windowInfo) => (windowInfo.hwnd ? [windowInfo.hwnd.toLowerCase()] : []))
      );
      const newDetectedWindows = toVirtualWindows(detected).filter(
        (windowInfo) => !windowInfo.isHelper && windowInfo.hwnd && !knownHwnds.has(windowInfo.hwnd.toLowerCase())
      );
      const existingTargetHwnd = findExistingActivityTarget(
        detected,
        knownHwnds,
        sourceHwnd,
        metadataRefresh.changedHwnds
      );
      const changedActivityHwnds = sourceHwnd
        ? metadataRefresh.changedHwnds.filter((hwnd) => hwnd.toLowerCase() !== sourceHwnd.toLowerCase())
        : metadataRefresh.changedHwnds;
      const activityHwnds = [
        ...changedActivityHwnds,
        ...(existingTargetHwnd ? [existingTargetHwnd] : [])
      ];
      markWindowActivity(activityHwnds);

      if (metadataRefresh.changedHwnds.length > 0) {
        const refreshedInitial = refreshVirtualWindowMetadata(initialVirtualWindowsRef.current, detected).windows;
        const refreshedRegions = updateRegionMembership(refreshedWindows, regionsRef.current);
        virtualWindowsRef.current = refreshedWindows;
        initialVirtualWindowsRef.current = refreshedInitial;
        regionsRef.current = refreshedRegions;
        setCanvasWindows(refreshedWindows);
        setInitialVirtualWindows(refreshedInitial);
        setCanvasRegions(refreshedRegions);
        setWindows(detected);
      }
      if (newDetectedWindows.length === 0) {
        if (sourceHwnd && existingTargetHwnd) {
          focusCameraOnWindow(existingTargetHwnd);
          const target = detected.find((windowInfo) => windowInfo.hwnd.toLowerCase() === existingTargetHwnd.toLowerCase());
          setMessage(`${target?.processName || 'An existing window'} received new activity.`);
          return 1;
        }
        return 0;
      }

      setWindows(detected);
      const placedWindows = placementPoint
        ? placeDetectedWindowsAtPoint(newDetectedWindows, placementPoint)
        : placeDetectedWindowsNearSource(newDetectedWindows, refreshedWindows, sourceHwnd);
      const nextWindows = [...refreshedWindows, ...placedWindows];
      const nextInitialWindows = [
        ...refreshVirtualWindowMetadata(initialVirtualWindowsRef.current, detected).windows,
        ...placedWindows.map((windowInfo) => ({ ...windowInfo, isDirty: false }))
      ];
      const nextRegions = updateRegionMembership(nextWindows, regionsRef.current);

      virtualWindowsRef.current = nextWindows;
      initialVirtualWindowsRef.current = nextInitialWindows;
      regionsRef.current = nextRegions;
      setCanvasWindows(nextWindows);
      setInitialVirtualWindows(nextInitialWindows);
      setCanvasRegions(nextRegions);
      setCanvasPreviewWorkspace(null);
      const preferredHwnd = preferredDockApp
        ? detected.find(
            (windowInfo) =>
              processMatchesDockApp(windowInfo, preferredDockApp) &&
              newDetectedWindows.some((candidate) => candidate.hwnd?.toLowerCase() === windowInfo.hwnd.toLowerCase())
          )?.hwnd
        : undefined;
      const focusTarget =
        placedWindows.find((windowInfo) => windowInfo.hwnd?.toLowerCase() === preferredHwnd?.toLowerCase()) ||
        placedWindows[placedWindows.length - 1];
      markWindowActivity(placedWindows.flatMap((windowInfo) => (windowInfo.hwnd ? [windowInfo.hwnd] : [])));
      focusCameraOnWindow(focusTarget?.hwnd);
      setMessage(
        `${placedWindows.length} new window${placedWindows.length === 1 ? '' : 's'} opened and added to InfiniteDesk.`
      );
      return placedWindows.length;
    } catch (scanError) {
      setError(`Could not detect a newly opened window: ${(scanError as Error).message}`);
      return 0;
    } finally {
      autoScanInFlightRef.current = false;
    }
  }

  function scheduleNewWindowScans(sourceHwnd: string): void {
    latestInteractionSourceRef.current = sourceHwnd;
    if (autoScanTimersRef.current.length > 0) {
      return;
    }
    interactionScanGenerationRef.current += 1;
    const generation = interactionScanGenerationRef.current;
    autoScanTimersRef.current = INTERACTION_SCAN_DELAYS_MS.map((delay) =>
      window.setTimeout(() => {
        void scanForNewWindows(latestInteractionSourceRef.current).then((handledCount) => {
          if (generation !== interactionScanGenerationRef.current) {
            return;
          }
          if (handledCount > 0) {
            autoScanTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
            autoScanTimersRef.current = [];
            interactionScanGenerationRef.current += 1;
          } else if (delay === INTERACTION_SCAN_DELAYS_MS[INTERACTION_SCAN_DELAYS_MS.length - 1]) {
            autoScanTimersRef.current = [];
          }
        });
      }, delay)
    );
  }

  function removeClosedWindowNode(hwnd: string): void {
    const normalizedHwnd = hwnd.toLowerCase();
    const currentWindows = virtualWindowsRef.current;
    const nextWindows = currentWindows.filter((windowInfo) => windowInfo.hwnd?.toLowerCase() !== normalizedHwnd);
    if (nextWindows.length === currentWindows.length) {
      return;
    }

    const nextInitialWindows = initialVirtualWindowsRef.current.filter(
      (windowInfo) => windowInfo.hwnd?.toLowerCase() !== normalizedHwnd
    );
    const nextRegions = updateRegionMembership(nextWindows, regionsRef.current);
    initialVirtualWindowsRef.current = nextInitialWindows;
    pruneCanvasHistoryForClosedWindow(normalizedHwnd);
    setWindows((current) => current.filter((windowInfo) => windowInfo.hwnd.toLowerCase() !== normalizedHwnd));
    setCanvasWindows(nextWindows);
    setInitialVirtualWindows(nextInitialWindows);
    setCanvasRegions(nextRegions);
    setEmbeddedWindowIds((current) => current.filter((item) => item.toLowerCase() !== normalizedHwnd));
    setActivityWindowHwnds((current) => current.filter((item) => item !== normalizedHwnd));
    setSelectedWindowKeys((current) =>
      current.filter((key) => nextWindows.some((windowInfo, index) => getWindowKey(windowInfo, index) === key))
    );
    setCanvasPreviewWorkspace(null);
    setMessage('A closed application window was removed from InfiniteDesk.');
  }

  async function saveWorkspace(forceNewName = false): Promise<void> {
    const currentVirtualWindows = virtualWindowsRef.current;
    if (currentVirtualWindows.length === 0) {
      setError('There is no canvas state to save as a workspace.');
      return;
    }

    const defaultName =
      !forceNewName && previewWorkspace
        ? previewWorkspace.name
        : `Workspace ${new Date().toLocaleString()}`;
    const name = window.prompt('Workspace name', defaultName);
    if (name === null) {
      return;
    }

    setError(null);
    try {
      const savedWindows = currentVirtualWindows.map((windowInfo) => ({
        ...windowInfo,
        initialVirtualX: windowInfo.virtualX,
        initialVirtualY: windowInfo.virtualY,
        isDirty: false
      }));
      const workspace = await window.infiniteDesk.createWorkspace({
        name,
        windows: savedWindows.map(virtualWindowToDetected),
        regions: []
      });
      await loadWorkspaces();
      setCanvasPreviewWorkspace(workspace);
      setCanvasRegions([]);
      setCanvasWindows(savedWindows);
      setInitialVirtualWindows(savedWindows);
      clearCanvasHistory();
      setMessage(`Saved workspace "${workspace.name}" with ${workspace.windows.length} windows.`);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsBrandMenuOpen(false);
    }
  }

  function toggleThemeMode(): void {
    setThemeMode((current) => (current === 'mist' ? 'graphite' : 'mist'));
  }

  async function restoreWorkspace(workspace: SavedWorkspace): Promise<void> {
    setError(null);
    try {
      const result = await window.infiniteDesk.restoreWorkspace(workspace.id);
      setMessage(`Restored workspace "${workspace.name}". ${restoreResultText(result)}`);
    } catch (restoreError) {
      setError((restoreError as Error).message);
    }
  }

  async function deleteWorkspace(workspace: SavedWorkspace): Promise<void> {
    await window.infiniteDesk.deleteWorkspace(workspace.id);
    if (previewWorkspace?.id === workspace.id) {
      setCanvasPreviewWorkspace(null);
    }
    await loadWorkspaces();
    setMessage(`Deleted workspace "${workspace.name}".`);
  }

  function previewWorkspaceOnCanvas(workspace: SavedWorkspace): void {
    const workspaceWindows = toVirtualWindows(workspace.windows);
    setWindows(workspace.windows);
    loadVirtualLayout(workspaceWindows, workspace);
    setIsDrawerOpen(false);
    setMessage(`Loaded workspace "${workspace.name}" onto the canvas.`);
  }

  function resetLayoutEdits(): void {
    checkpointCanvasHistory();
    const nextWindows = initialVirtualWindows.map((windowInfo) => ({ ...windowInfo, isDirty: false }));
    setCanvasWindows(nextWindows);
    setCanvasRegions(updateRegionMembership(initialVirtualWindows, regionsRef.current.map((region) => ({ ...region, isDirty: false }))));
    setMessage('Canvas layout edits were reset.');
    setIsBrandMenuOpen(false);
  }

  useEffect(() => {
    void loadWorkspaces();
    void loadDockApps();
    void loadQuickLaunches();
    void scanWindows();
  }, []);

  useEffect(() => {
    virtualWindowsRef.current = virtualWindows;
  }, [virtualWindows]);

  useEffect(() => {
    initialVirtualWindowsRef.current = initialVirtualWindows;
  }, [initialVirtualWindows]);

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  useEffect(() => {
    previewWorkspaceRef.current = previewWorkspace;
  }, [previewWorkspace]);

  useEffect(() => {
    selectedRegionIdRef.current = selectedRegionId;
  }, [selectedRegionId]);

  useEffect(() => {
    const unsubscribeInteraction = window.infiniteDesk.onWindowInteractionComplete((sourceHwnd) => {
      acknowledgeWindowActivity(sourceHwnd);
      if (previewWorkspace) {
        return;
      }
      scheduleNewWindowScans(sourceHwnd);
    });
    const unsubscribeClosed = window.infiniteDesk.onWindowClosed((hwnd) => {
      removeClosedWindowNode(hwnd);
    });

    return () => {
      unsubscribeInteraction();
      unsubscribeClosed();
      autoScanTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      autoScanTimersRef.current = [];
    };
  }, [previewWorkspace]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (!hasCompletedInitialScanRef.current || isScanning || previewWorkspace) {
        return;
      }

      void scanForNewWindows('');
    }, AUTO_WINDOW_SCAN_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [isScanning, previewWorkspace]);

  useEffect(() => {
    const unsubscribeShortcut = window.infiniteDesk.onInteractiveShortcut((action) => {
      if (action === 'scan') {
        void scanWindows();
        return;
      }

      const embeddedSet = new Set(embeddedWindowIds.map((hwnd) => hwnd.toLowerCase()));
      const selectedSet = new Set(selectedWindowKeys);
      const selectedEmbeddedHwnd = virtualWindows.find(
        (windowInfo, index) =>
          Boolean(windowInfo.hwnd) &&
          embeddedSet.has(windowInfo.hwnd!.toLowerCase()) &&
          selectedSet.has(getWindowKey(windowInfo, index))
      )?.hwnd;
      const targetHwnd = selectedEmbeddedHwnd || embeddedWindowIds.at(-1);
      if (targetHwnd) {
        void detachRealWindow(targetHwnd);
      }
    });

    return unsubscribeShortcut;
  }, [embeddedWindowIds, selectedWindowKeys, virtualWindows]);

  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent): void {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      if (event.key === 'Escape') {
        setIsDrawerOpen(false);
        setIsBrandMenuOpen(false);
        return;
      }

      if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'f') {
          event.preventDefault();
          setFitSignal((value) => value + 1);
        } else if (event.key === '1') {
          event.preventDefault();
          setActualSizeSignal((value) => value + 1);
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          setZoomInSignal((value) => value + 1);
        } else if (event.key === '-' || event.key === '_') {
          event.preventDefault();
          setZoomOutSignal((value) => value + 1);
        }
        return;
      }

      if (!isPrimaryShortcut(event)) {
        return;
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void scanWindows();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveWorkspace(event.shiftKey);
      } else if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoCanvasEdit();
        } else {
          undoCanvasEdit();
        }
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoCanvasEdit();
      } else if (event.key === '0') {
        event.preventDefault();
        setFitSignal((value) => value + 1);
      } else if (event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void toggleOverlayMode();
      }
    }

    window.addEventListener('keydown', handleShortcuts);
    return () => window.removeEventListener('keydown', handleShortcuts);
  }, [virtualWindows, overlayModeEnabled, previewWorkspace]);

  return (
    <main
      className={`immersive-shell theme-${themeMode} ${overlayModeEnabled ? 'overlay-mode' : ''} ${isDrawerOpen ? 'drawer-open' : ''} ${isBrandMenuOpen ? 'brand-menu-open' : ''} ${isDockOverlayActive ? 'dock-open' : ''} ${virtualWindows.length > 0 ? 'has-running-windows' : ''}`}
    >
      <header className="workspace-top-bar" data-dwm-ui-overlay="true">
        <BrandMenu
          isOpen={isBrandMenuOpen}
          onToggle={() => setIsBrandMenuOpen((value) => !value)}
          onScan={() => void scanWindows()}
          onOpenDetails={() => setIsDrawerOpen((value) => !value)}
          onToggleTheme={toggleThemeMode}
          themeMode={themeMode}
          onQuit={() => void quitInfiniteDesk()}
        />

        <div className={`workspace-bar-status ${error ? 'error' : ''}`} title={error || message}>
          {error || canvasLabel}
        </div>

        <ViewControls
          isExpanded={isViewControlsExpanded}
          onExpandedChange={setIsViewControlsExpanded}
          zoomScale={zoomScale}
          isDrawerOpen={isDrawerOpen}
          onToggleDrawer={() => setIsDrawerOpen((value) => !value)}
          onZoomIn={() => setZoomInSignal((value) => value + 1)}
          onZoomOut={() => setZoomOutSignal((value) => value + 1)}
          onActualSize={() => setActualSizeSignal((value) => value + 1)}
          onFit={() => setFitSignal((value) => value + 1)}
        />
      </header>

      <section className="workspace-stage">
        <CanvasPreview
          windows={virtualWindows}
          regions={regions}
          safeArea={canvasSafeArea}
          uiOverlayActive={isDrawerOpen || isDockOverlayActive || isBrandMenuOpen || isViewControlsExpanded}
          selectedRegionId={selectedRegionId}
          selectedWindowKeys={selectedWindowKeys}
          embeddedWindowIds={embeddedWindowIds}
          onWindowsChange={setCanvasWindows}
          onRegionsChange={setCanvasRegions}
          onSelectRegion={setCanvasSelectedRegionId}
          onSelectWindowKeys={setSelectedWindowKeys}
          onCanvasHistoryCheckpoint={checkpointCanvasHistory}
          onWorkWindow={(hwnd) => void workInRealWindow(hwnd)}
          onWindowCommand={(hwnd, command) => void controlRealWindow(hwnd, command)}
          onEmbedWindow={(windowInfo, bounds) => void embedRealWindow(windowInfo, bounds)}
          onDetachEmbeddedWindow={(hwnd) => void detachRealWindow(hwnd)}
          onMoveEmbeddedWindow={(params) => void moveEmbeddedWindow(params)}
          onSyncDwmPreviews={(previews) => void syncDwmPreviews(previews)}
          onClearDwmPreviews={() => void clearDwmPreviews()}
          onRelayPointerInput={(input) => void relayPointerInput(input)}
          onScanWindows={() => void scanWindows()}
          canvasLaunchApps={pinnedDockApps}
          onLaunchAppAt={(dockApp, point) => void launchDockApp(dockApp, point)}
          onPinWindowToQuickLaunch={(windowInfo) => void pinWindowToQuickLaunch(windowInfo)}
          fixedPreviewSources={quickLaunchPreviewSources}
          fixedPreviewFrameVersion={quickLaunchPreviewFrameVersion}
          onCanvasBackgroundPointerDown={() => setCloseDockSignal((value) => value + 1)}
          onApplyWindows={(targetWindows) => void applyWindows(targetWindows)}
          fitSignal={fitSignal}
          resetViewSignal={resetViewSignal}
          zoomInSignal={zoomInSignal}
          zoomOutSignal={zoomOutSignal}
          actualSizeSignal={actualSizeSignal}
          cameraFocusRequest={cameraFocusRequest}
          activityWindowHwnds={activityWindowHwnds}
          onAcknowledgeWindowActivity={acknowledgeWindowActivity}
          onZoomChange={setZoomScale}
        />

        <QuickLaunchPanel
          quickLaunches={quickLaunches}
          launchingAppId={launchingAppId}
          previewSourceIds={quickLaunchPreviewSourceIds}
          layout={quickLaunchPanelLayout}
          onLayoutChange={updateQuickLaunchPanelLayout}
          onPreviewFrameChange={bumpQuickLaunchPreviewFrame}
          onLaunch={launchQuickLaunch}
          onDelete={(quickLaunch) => void deleteQuickLaunch(quickLaunch)}
        />

        <aside data-dwm-ui-overlay={isDrawerOpen ? 'true' : undefined} className={`floating-drawer immersive-drawer ${isDrawerOpen ? 'open' : ''}`}>
          <div className="details-drawer-header">
            <strong>Details</strong>
            <button type="button" title="Close details" aria-label="Close details" onClick={() => setIsDrawerOpen(false)}>
              <X size={15} />
            </button>
          </div>

          <StatusPanel
            message={message}
            restorableCount={restorableCount}
            dirtyCount={dirtyCount}
            workspacesCount={workspaces.length}
            overlayModeEnabled={overlayModeEnabled}
            applyDisabled={virtualWindows.length === 0}
            resetDisabled={dirtyCount === 0}
            onSaveWorkspace={() => void saveWorkspace()}
            onApplyLayout={() => void applyCanvasLayout()}
            onResetEdits={resetLayoutEdits}
            onToggleOverlay={() => void toggleOverlayMode()}
          />

          <WorkspaceList
            workspaces={workspaces}
            onPreview={previewWorkspaceOnCanvas}
            onRestore={(workspace) => void restoreWorkspace(workspace)}
            onDelete={(workspace) => void deleteWorkspace(workspace)}
          />
        </aside>
      </section>

      <footer className="workspace-bottom-bar" data-dwm-ui-overlay="true">
        <Dock
          apps={dockApps}
          pinnedApps={pinnedDockApps}
          runningWindows={runningDockWindows}
          selectedWindowKeys={selectedWindowKeys}
          activityWindowHwnds={activityWindowHwnds}
          statusLabel={canvasLabel}
          launchingAppId={launchingAppId}
          isLoadingApps={isLoadingDockApps}
          closeSignal={closeDockSignal}
          onLaunch={(dockApp) => void launchDockApp(dockApp)}
          onPinApp={(dockApp) => void pinDockApp(dockApp)}
          onUnpinApp={(dockApp) => void unpinDockApp(dockApp)}
          onSelectWindow={selectWindowFromDock}
          onFocusWindow={(windowInfo) => windowInfo.hwnd ? void controlRealWindow(windowInfo.hwnd, 'focus') : undefined}
          onZoomWindow={zoomWindowFromDock}
          onRemoveWindow={(windowInfo, index) => {
            const canvasIndex = windowInfo.hwnd
              ? virtualWindowsRef.current.findIndex((candidate) => candidate.hwnd?.toLowerCase() === windowInfo.hwnd!.toLowerCase())
              : index;
            const canvasWindow = canvasIndex >= 0 ? virtualWindowsRef.current[canvasIndex] : null;
            if (!canvasWindow) {
              setMessage(`${windowInfo.title || windowInfo.processName} is running but is not on the canvas.`);
              return;
            }

            const removedKey = getWindowKey(canvasWindow, canvasIndex);
            checkpointCanvasHistory();
            const nextWindows = virtualWindowsRef.current.filter(
              (candidate, candidateIndex) => getWindowKey(candidate, candidateIndex) !== removedKey
            );
            const nextRegions = updateRegionMembership(nextWindows, regionsRef.current);
            setCanvasWindows(nextWindows);
            setCanvasRegions(nextRegions);
            setSelectedWindowKeys((current) => current.filter((key) => key !== removedKey));
            setCanvasPreviewWorkspace(null);
          }}
          onCloseWindow={(windowInfo) => windowInfo.hwnd ? void controlRealWindow(windowInfo.hwnd, 'close') : undefined}
          onOverlayActiveChange={setIsDockOverlayActive}
        />
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
