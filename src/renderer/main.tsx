import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DetectedWindow, DockApp, LayoutTemplate, SavedWorkspace } from '../shared/types';
import { createRegionFromTemplate, getWindowIdentity, getWindowsForRegion, updateRegionMembership } from './canvas/regions';
import { createInitialVirtualLayout, toVirtualWindow, toVirtualWindows } from './canvas/windows';
import type { TemplateRegion, VirtualWindowState } from './canvas/types';
import {
  virtualWindowToDetected,
  restoreResultText,
  workspaceRegionToTemplateRegion,
  regionToWorkspaceRegion,
  processMatchesDockApp,
  placeVirtualWindowInRegion,
  placeDetectedWindowsNearSource
} from './canvas/layout-helpers';
import { useWindowControlActions } from './hooks/useWindowControlActions';
import { CanvasPreview } from './components/CanvasPreview';
import { Dock } from './components/Dock';
import { BrandMenu } from './components/BrandMenu';
import { ViewControls } from './components/ViewControls';
import { StatusPanel } from './components/StatusPanel';
import { RegionsList } from './components/RegionsList';
import { WorkspaceList } from './components/WorkspaceList';
import { TemplateList } from './components/TemplateList';
import { defaultDockApps } from './dock/apps';
import './styles/base.css';
import './styles/theme.css';
import './styles/chrome.css';

function App(): React.JSX.Element {
  const [windows, setWindows] = useState<DetectedWindow[]>([]);
  const [virtualWindows, setVirtualWindows] = useState<VirtualWindowState[]>([]);
  const [initialVirtualWindows, setInitialVirtualWindows] = useState<VirtualWindowState[]>([]);
  const [regions, setRegions] = useState<TemplateRegion[]>([]);
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isBrandMenuOpen, setIsBrandMenuOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState('Scan Windows to start. Then Ctrl+Drag on the canvas to create a template region.');
  const [error, setError] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<LayoutTemplate | null>(null);
  const [previewWorkspace, setPreviewWorkspace] = useState<SavedWorkspace | null>(null);
  const [themeMode, setThemeMode] = useState<'mist' | 'graphite'>('mist');
  const [fitSignal, setFitSignal] = useState(0);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [zoomInSignal, setZoomInSignal] = useState(0);
  const [zoomOutSignal, setZoomOutSignal] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [localDockApps, setLocalDockApps] = useState<DockApp[]>([]);
  const [isLoadingDockApps, setIsLoadingDockApps] = useState(false);
  const [isDockOverlayActive, setIsDockOverlayActive] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [overlayModeEnabled, setOverlayModeEnabled] = useState(false);
  const [embeddedWindowIds, setEmbeddedWindowIds] = useState<string[]>([]);
  const [isViewControlsExpanded, setIsViewControlsExpanded] = useState(false);
  const virtualWindowsRef = useRef<VirtualWindowState[]>([]);
  const initialVirtualWindowsRef = useRef<VirtualWindowState[]>([]);
  const regionsRef = useRef<TemplateRegion[]>([]);
  const autoScanInFlightRef = useRef(false);
  const autoScanTimersRef = useRef<number[]>([]);
  const latestInteractionSourceRef = useRef('');

  const canvasLabel = previewTemplate
    ? `Previewing template: ${previewTemplate.name}`
    : previewWorkspace
      ? `Previewing workspace: ${previewWorkspace.name}`
    : `${virtualWindows.length} windows - ${regions.length} regions`;
  const dirtyCount = virtualWindows.filter((windowInfo) => windowInfo.isDirty).length + regions.filter((region) => region.isDirty).length;
  const restorableCount = useMemo(() => windows.filter((windowInfo) => windowInfo.isRestorable && !windowInfo.isInternal).length, [windows]);
  const dockApps = useMemo(() => {
    const apps = [...defaultDockApps, ...localDockApps];
    const seen = new Set<string>();
    return apps.filter((app) => {
      const key = `${app.name.toLowerCase()}|${app.executablePath.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [localDockApps]);
  const canvasSafeArea = useMemo(
    () => ({
      left: 64,
      top: 64,
      right: 72,
      bottom: 44
    }),
    []
  );

  const {
    workInRealWindow,
    controlRealWindow,
    embedRealWindow,
    relayPointerInput,
    detachRealWindow,
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

  async function loadTemplates(): Promise<void> {
    const loaded = await window.infiniteDesk.listTemplates();
    setTemplates(loaded);
  }

  async function loadWorkspaces(): Promise<void> {
    const loaded = await window.infiniteDesk.listWorkspaces();
    setWorkspaces(loaded);
  }

  async function loadDockApps(): Promise<void> {
    setIsLoadingDockApps(true);
    try {
      const loaded = await window.infiniteDesk.listDockApps();
      setLocalDockApps(loaded);
    } catch (dockError) {
      setError(`Could not load local apps: ${(dockError as Error).message}`);
    } finally {
      setIsLoadingDockApps(false);
    }
  }

  function loadVirtualLayout(
    nextWindows: VirtualWindowState[],
    nextRegions: TemplateRegion[],
    template: LayoutTemplate | null,
    workspace: SavedWorkspace | null = null
  ): void {
    const normalizedWindows = nextWindows.map((windowInfo) => ({
      ...windowInfo,
      initialVirtualX: windowInfo.virtualX,
      initialVirtualY: windowInfo.virtualY,
      isDirty: false
    }));
    const normalizedRegions = updateRegionMembership(
      normalizedWindows,
      nextRegions.map((region) => ({ ...region, isDirty: false }))
    );

    setVirtualWindows(normalizedWindows);
    setInitialVirtualWindows(normalizedWindows);
    setRegions(normalizedRegions);
    setSelectedRegionId(null);
    setPreviewTemplate(template);
    setPreviewWorkspace(workspace);
    setFitSignal((value) => value + 1);
  }

  async function scanWindows(): Promise<void> {
    setIsScanning(true);
    setError(null);
    try {
      const detected = await window.infiniteDesk.scanWindows();
      const layout = createInitialVirtualLayout(detected);
      setWindows(detected);
      loadVirtualLayout(layout, [], null);
      setMessage(`Scanned ${detected.length} windows. ${layout.length} are on the canvas.`);
    } catch (scanError) {
      setError((scanError as Error).message);
    } finally {
      setIsScanning(false);
      setIsBrandMenuOpen(false);
    }
  }

  async function scanAfterLaunch(dockApp: DockApp): Promise<void> {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 1400);
    });

    try {
      const detected = await window.infiniteDesk.scanWindows();
      setWindows(detected);
      const activeRegion = selectedRegionId ? regions.find((region) => region.id === selectedRegionId) || null : null;

      if (!activeRegion) {
        const layout = createInitialVirtualLayout(detected);
        loadVirtualLayout(layout, [], null);
        setMessage(`Launched ${dockApp.name}. Scanned ${detected.length} windows.`);
        return;
      }

      const knownHwnds = new Set(virtualWindows.flatMap((windowInfo) => (windowInfo.hwnd ? [windowInfo.hwnd] : [])));
      const matchedDetectedWindow =
        detected.find((windowInfo) => processMatchesDockApp(windowInfo, dockApp) && windowInfo.hwnd && !knownHwnds.has(windowInfo.hwnd)) ||
        detected.find((windowInfo) => processMatchesDockApp(windowInfo, dockApp));
      const matchedVirtualWindow = matchedDetectedWindow ? toVirtualWindow(matchedDetectedWindow) : null;

      if (!matchedVirtualWindow) {
        const layout = createInitialVirtualLayout(detected);
        loadVirtualLayout(layout, regions, null);
        setSelectedRegionId(activeRegion.id);
        setMessage(`Launched ${dockApp.name}, but no matching window was found for ${dockApp.processName || dockApp.id}.`);
        return;
      }

      const nextWindow = placeVirtualWindowInRegion(matchedVirtualWindow, activeRegion, activeRegion.windowIds.length);
      const nextWindows = [
        ...virtualWindows.filter((windowInfo) => getWindowIdentity(windowInfo) !== getWindowIdentity(nextWindow)),
        nextWindow
      ];
      const nextRegions = updateRegionMembership(nextWindows, regions);
      setVirtualWindows(nextWindows);
      setInitialVirtualWindows((current) => [
        ...current.filter((windowInfo) => getWindowIdentity(windowInfo) !== getWindowIdentity(nextWindow)),
        {
          ...nextWindow,
          initialVirtualX: nextWindow.virtualX,
          initialVirtualY: nextWindow.virtualY,
          isDirty: false
        }
      ]);
      setRegions(nextRegions);
      setPreviewTemplate(null);
      setSelectedRegionId(activeRegion.id);
      setMessage(`${dockApp.name} added to ${activeRegion.name}.`);
    } catch (scanError) {
      setError(`${dockApp.name} launched, but scanning failed: ${(scanError as Error).message}`);
    }
  }

  async function launchDockApp(dockApp: DockApp): Promise<void> {
    setLaunchingAppId(dockApp.id);
    setError(null);
    try {
      const result = await window.infiniteDesk.launchApp(dockApp);
      if (!result.success) {
        setError(result.error || `${dockApp.name} could not be launched.`);
        return;
      }

      setMessage(`Launching ${dockApp.name}...`);
      await scanAfterLaunch(dockApp);
    } catch (launchError) {
      setError((launchError as Error).message);
    } finally {
      setLaunchingAppId(null);
    }
  }

  async function saveSingleRegion(region: TemplateRegion): Promise<void> {
    const regionWindows = getWindowsForRegion(virtualWindows, region);
    if (regionWindows.length === 0) {
      setError(`"${region.name}" has no windows to save.`);
      return;
    }

    setError(null);
    try {
      await window.infiniteDesk.createTemplate({
        name: region.name,
        windows: regionWindows.map(virtualWindowToDetected)
      });
      await loadTemplates();
      setRegions((current) => current.map((item) => (item.id === region.id ? { ...item, isDirty: false } : item)));
      setMessage(`Saved region "${region.name}" with ${regionWindows.length} windows.`);
    } catch (saveError) {
      setError((saveError as Error).message);
    }
  }

  async function saveRegions(): Promise<void> {
    if (regions.length === 0) {
      setError('Create a region with Ctrl+Drag before saving.');
      return;
    }

    setError(null);
    try {
      let savedCount = 0;
      for (const region of regions) {
        const regionWindows = getWindowsForRegion(virtualWindows, region);
        if (regionWindows.length === 0) {
          continue;
        }

        await window.infiniteDesk.createTemplate({
          name: region.name,
          windows: regionWindows.map(virtualWindowToDetected)
        });
        savedCount++;
      }

      if (savedCount === 0) {
        setError('No regions contain windows yet. Drag windows into a region before saving.');
        return;
      }

      await loadTemplates();
      setRegions((current) => current.map((region) => ({ ...region, isDirty: false })));
      setMessage(`Saved ${savedCount} template regions.`);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsBrandMenuOpen(false);
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

  async function scanForNewWindows(sourceHwnd: string): Promise<void> {
    if (autoScanInFlightRef.current) {
      return;
    }

    autoScanInFlightRef.current = true;
    try {
      const detected = await window.infiniteDesk.scanWindows();
      setWindows(detected);

      const currentWindows = virtualWindowsRef.current;
      const knownHwnds = new Set(currentWindows.flatMap((windowInfo) => (windowInfo.hwnd ? [windowInfo.hwnd] : [])));
      const newDetectedWindows = toVirtualWindows(detected).filter(
        (windowInfo) => !windowInfo.isHelper && windowInfo.hwnd && !knownHwnds.has(windowInfo.hwnd)
      );
      if (newDetectedWindows.length === 0) {
        return;
      }

      const placedWindows = placeDetectedWindowsNearSource(newDetectedWindows, currentWindows, sourceHwnd);
      const nextWindows = [...currentWindows, ...placedWindows];
      const nextInitialWindows = [
        ...initialVirtualWindowsRef.current,
        ...placedWindows.map((windowInfo) => ({ ...windowInfo, isDirty: false }))
      ];
      const nextRegions = updateRegionMembership(nextWindows, regionsRef.current);

      virtualWindowsRef.current = nextWindows;
      initialVirtualWindowsRef.current = nextInitialWindows;
      regionsRef.current = nextRegions;
      setVirtualWindows(nextWindows);
      setInitialVirtualWindows(nextInitialWindows);
      setRegions(nextRegions);
      setPreviewTemplate(null);
      setPreviewWorkspace(null);
      setMessage(
        `${placedWindows.length} new window${placedWindows.length === 1 ? '' : 's'} opened and added to InfiniteDesk.`
      );
    } catch (scanError) {
      setError(`Could not detect a newly opened window: ${(scanError as Error).message}`);
    } finally {
      autoScanInFlightRef.current = false;
    }
  }

  function scheduleNewWindowScans(sourceHwnd: string): void {
    latestInteractionSourceRef.current = sourceHwnd;
    if (autoScanTimersRef.current.length > 0) {
      return;
    }
    autoScanTimersRef.current = [350, 1100, 2400].map((delay) =>
      window.setTimeout(() => {
        void scanForNewWindows(latestInteractionSourceRef.current);
        if (delay === 2400) {
          autoScanTimersRef.current = [];
        }
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
    virtualWindowsRef.current = nextWindows;
    initialVirtualWindowsRef.current = nextInitialWindows;
    regionsRef.current = nextRegions;
    setWindows((current) => current.filter((windowInfo) => windowInfo.hwnd.toLowerCase() !== normalizedHwnd));
    setVirtualWindows(nextWindows);
    setInitialVirtualWindows(nextInitialWindows);
    setRegions(nextRegions);
    setEmbeddedWindowIds((current) => current.filter((item) => item.toLowerCase() !== normalizedHwnd));
    setPreviewTemplate(null);
    setPreviewWorkspace(null);
    setMessage('A closed application window was removed from InfiniteDesk.');
  }

  async function saveWorkspace(): Promise<void> {
    if (virtualWindows.length === 0 && regions.length === 0) {
      setError('There is no canvas state to save as a workspace.');
      return;
    }

    const name = window.prompt('Workspace name', previewWorkspace?.name || `Workspace ${new Date().toLocaleString()}`);
    if (name === null) {
      return;
    }

    setError(null);
    try {
      const savedWindows = virtualWindows.map((windowInfo) => ({
        ...windowInfo,
        initialVirtualX: windowInfo.virtualX,
        initialVirtualY: windowInfo.virtualY,
        isDirty: false
      }));
      const workspace = await window.infiniteDesk.createWorkspace({
        name,
        windows: savedWindows.map(virtualWindowToDetected),
        regions: regions.map(regionToWorkspaceRegion)
      });
      await loadWorkspaces();
      setPreviewWorkspace(workspace);
      setPreviewTemplate(null);
      setRegions((current) => current.map((region) => ({ ...region, isDirty: false })));
      setVirtualWindows(savedWindows);
      setInitialVirtualWindows(savedWindows);
      setMessage(`Saved workspace "${workspace.name}" with ${workspace.windows.length} windows and ${workspace.regions.length} regions.`);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setIsBrandMenuOpen(false);
    }
  }

  function toggleThemeMode(): void {
    setThemeMode((current) => (current === 'mist' ? 'graphite' : 'mist'));
  }

  async function restoreTemplate(template: LayoutTemplate): Promise<void> {
    setError(null);
    try {
      const result = await window.infiniteDesk.restoreTemplate(template.id);
      setMessage(`Restored "${template.name}". ${restoreResultText(result)}`);
    } catch (restoreError) {
      setError((restoreError as Error).message);
    }
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

  async function deleteTemplate(template: LayoutTemplate): Promise<void> {
    await window.infiniteDesk.deleteTemplate(template.id);
    if (previewTemplate?.id === template.id) {
      setPreviewTemplate(null);
    }
    await loadTemplates();
    setMessage(`Deleted "${template.name}".`);
  }

  async function deleteWorkspace(workspace: SavedWorkspace): Promise<void> {
    await window.infiniteDesk.deleteWorkspace(workspace.id);
    if (previewWorkspace?.id === workspace.id) {
      setPreviewWorkspace(null);
    }
    await loadWorkspaces();
    setMessage(`Deleted workspace "${workspace.name}".`);
  }

  function previewTemplateOnCanvas(template: LayoutTemplate): void {
    const { region, windows: templateWindows } = createRegionFromTemplate(template);
    loadVirtualLayout(templateWindows, region ? [region] : [], template);
    setIsDrawerOpen(false);
    setMessage(`Previewing template "${template.name}". Region bounds were created around saved windows.`);
  }

  function previewWorkspaceOnCanvas(workspace: SavedWorkspace): void {
    const workspaceWindows = toVirtualWindows(workspace.windows);
    const workspaceRegions = workspace.regions.map(workspaceRegionToTemplateRegion);
    setWindows(workspace.windows);
    loadVirtualLayout(workspaceWindows, workspaceRegions, null, workspace);
    setIsDrawerOpen(false);
    setMessage(`Loaded workspace "${workspace.name}" onto the canvas.`);
  }

  function resetLayoutEdits(): void {
    setVirtualWindows(initialVirtualWindows.map((windowInfo) => ({ ...windowInfo, isDirty: false })));
    setRegions((current) => updateRegionMembership(initialVirtualWindows, current.map((region) => ({ ...region, isDirty: false }))));
    setMessage('Canvas layout edits were reset.');
    setIsBrandMenuOpen(false);
  }

  useEffect(() => {
    void loadTemplates();
    void loadWorkspaces();
    void loadDockApps();
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
    const unsubscribeInteraction = window.infiniteDesk.onWindowInteractionComplete((sourceHwnd) => {
      if (previewTemplate || previewWorkspace) {
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
  }, [previewTemplate, previewWorkspace]);

  useEffect(() => {
    function handleShortcuts(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsDrawerOpen(false);
        setIsBrandMenuOpen(false);
        return;
      }

      if (!event.ctrlKey) {
        return;
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void scanWindows();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRegions();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        void applyCanvasLayout();
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
  }, [virtualWindows, regions, overlayModeEnabled]);

  return (
    <main className={`immersive-shell theme-${themeMode} ${overlayModeEnabled ? 'overlay-mode' : ''} ${isDrawerOpen ? 'drawer-open' : ''}`}>
      <CanvasPreview
        windows={virtualWindows}
        regions={regions}
        safeArea={canvasSafeArea}
        uiOverlayActive={isDrawerOpen || isDockOverlayActive || isBrandMenuOpen || isViewControlsExpanded}
        selectedRegionId={selectedRegionId}
        embeddedWindowIds={embeddedWindowIds}
        onWindowsChange={setVirtualWindows}
        onRegionsChange={setRegions}
        onSelectRegion={setSelectedRegionId}
        onWorkWindow={(hwnd) => void workInRealWindow(hwnd)}
        onWindowCommand={(hwnd, command) => void controlRealWindow(hwnd, command)}
        onEmbedWindow={(windowInfo, bounds) => void embedRealWindow(windowInfo, bounds)}
        onDetachEmbeddedWindow={(hwnd) => void detachRealWindow(hwnd)}
        onMoveEmbeddedWindow={(params) => void moveEmbeddedWindow(params)}
        onSyncDwmPreviews={(previews) => void syncDwmPreviews(previews)}
        onClearDwmPreviews={() => void clearDwmPreviews()}
        onRelayPointerInput={(input) => void relayPointerInput(input)}
        onScanWindows={() => void scanWindows()}
        onSaveRegions={() => void saveRegions()}
        onApplyWindows={(targetWindows) => void applyWindows(targetWindows)}
        onSaveRegion={(region) => void saveSingleRegion(region)}
        fitSignal={fitSignal}
        resetViewSignal={resetViewSignal}
        zoomInSignal={zoomInSignal}
        zoomOutSignal={zoomOutSignal}
        onZoomChange={setZoomScale}
      />

      <BrandMenu
        isOpen={isBrandMenuOpen}
        onToggle={() => setIsBrandMenuOpen((value) => !value)}
        onScan={() => void scanWindows()}
        onSaveRegions={() => void saveRegions()}
        onSaveWorkspace={() => void saveWorkspace()}
        onApplyLayout={() => void applyCanvasLayout()}
        applyDisabled={virtualWindows.length === 0}
        onResetEdits={resetLayoutEdits}
        resetDisabled={dirtyCount === 0}
        onToggleOverlay={() => void toggleOverlayMode()}
        overlayModeEnabled={overlayModeEnabled}
        onOpenDetails={() => setIsDrawerOpen(true)}
        onToggleTheme={toggleThemeMode}
        themeMode={themeMode}
        onQuit={() => void quitInfiniteDesk()}
      />

      <ViewControls
        isExpanded={isViewControlsExpanded}
        onExpandedChange={setIsViewControlsExpanded}
        zoomScale={zoomScale}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => setIsDrawerOpen((value) => !value)}
        onZoomIn={() => setZoomInSignal((value) => value + 1)}
        onZoomOut={() => setZoomOutSignal((value) => value + 1)}
        onFit={() => setFitSignal((value) => value + 1)}
      />

      {error ? <div className="floating-error" data-dwm-ui-overlay="true">{error}</div> : null}

      <Dock
        apps={dockApps}
        pinnedApps={defaultDockApps}
        statusLabel={canvasLabel}
        launchingAppId={launchingAppId}
        isLoadingApps={isLoadingDockApps}
        onLaunch={(dockApp) => void launchDockApp(dockApp)}
        onOverlayActiveChange={setIsDockOverlayActive}
      />

      <aside data-dwm-ui-overlay={isDrawerOpen ? 'true' : undefined} className={`floating-drawer immersive-drawer ${isDrawerOpen ? 'open' : ''}`}>
        <StatusPanel
          message={message}
          restorableCount={restorableCount}
          regionsCount={regions.length}
          dirtyCount={dirtyCount}
          workspacesCount={workspaces.length}
          templatesCount={templates.length}
          overlayModeEnabled={overlayModeEnabled}
        />

        <RegionsList regions={regions} selectedRegionId={selectedRegionId} />

        <WorkspaceList
          workspaces={workspaces}
          onPreview={previewWorkspaceOnCanvas}
          onRestore={(workspace) => void restoreWorkspace(workspace)}
          onDelete={(workspace) => void deleteWorkspace(workspace)}
        />

        <TemplateList
          templates={templates}
          onPreview={previewTemplateOnCanvas}
          onRestore={(template) => void restoreTemplate(template)}
          onDelete={(template) => void deleteTemplate(template)}
        />
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
