import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box,
  BriefcaseBusiness,
  ChevronDown,
  Eye,
  Layers,
  LocateFixed,
  LogOut,
  Menu,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Undo2
} from 'lucide-react';
import type {
  DetectedWindow,
  DockApp,
  DwmPreviewWindow,
  LayoutTemplate,
  MoveEmbeddedWindowParams,
  RestoreResult,
  SavedWorkspace,
  WindowCommand,
  WorkspaceRegion
} from '../shared/types';
import { createRegionFromTemplate, getWindowIdentity, getWindowsForRegion, updateRegionMembership } from './canvas/regions';
import { createInitialVirtualLayout, toVirtualWindow, toVirtualWindows } from './canvas/windows';
import type { TemplateRegion, VirtualWindowState } from './canvas/types';
import { CanvasPreview } from './components/CanvasPreview';
import { Dock } from './components/Dock';
import { defaultDockApps } from './dock/apps';
import './styles.css';

function virtualWindowToDetected(windowInfo: VirtualWindowState): DetectedWindow {
  return {
    hwnd: windowInfo.hwnd || '',
    title: windowInfo.title,
    processName: windowInfo.processName,
    x: Math.round(windowInfo.virtualX),
    y: Math.round(windowInfo.virtualY),
    width: Math.round(windowInfo.width),
    height: Math.round(windowInfo.height),
    isMinimized: false,
    isRestorable: true,
    isInternal: false,
    isIgnored: windowInfo.isHelper,
    statusReason: windowInfo.isHelper ? 'Tiny helper window' : 'Ready'
  };
}

function restoreResultText(result: RestoreResult): string {
  const skippedText = result.skipped > 0 ? ` Skipped ${result.skipped}. ${result.errors.join(' ')}` : '';
  return `Restored ${result.restored} windows.${skippedText}`;
}

function interactiveControlNote(processName: string): string {
  const normalized = processName.toLowerCase();
  if (normalized.includes('kakao')) {
    return 'Custom UI. Detach if input or scaling looks off.';
  }
  if (normalized.includes('chrome') || normalized.includes('edge') || normalized.includes('msedge')) {
    return 'Browser windows may resist reparenting.';
  }
  if (normalized.includes('electron') || normalized.includes('code')) {
    return 'Electron apps can have focus quirks.';
  }
  return 'Ready for direct input.';
}

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

  const canvasLabel = previewTemplate
    ? `Previewing template: ${previewTemplate.name}`
    : previewWorkspace
      ? `Previewing workspace: ${previewWorkspace.name}`
    : `${virtualWindows.length} windows - ${regions.length} regions`;
  const dirtyCount = virtualWindows.filter((windowInfo) => windowInfo.isDirty).length + regions.filter((region) => region.isDirty).length;
  const restorableCount = useMemo(() => windows.filter((windowInfo) => windowInfo.isRestorable && !windowInfo.isInternal).length, [windows]);
  const selectedRegion = selectedRegionId ? regions.find((region) => region.id === selectedRegionId) || null : null;
  const attachedInteractiveWindows = useMemo(
    () =>
      embeddedWindowIds.map((hwnd) => {
        const windowInfo = virtualWindows.find((item) => item.hwnd === hwnd);
        return {
          hwnd,
          title: windowInfo?.title || hwnd,
          processName: windowInfo?.processName || 'unknown',
          note: interactiveControlNote(windowInfo?.processName || '')
        };
      }),
    [embeddedWindowIds, virtualWindows]
  );
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
      left: 260,
      top: 88,
      right: isDrawerOpen ? 380 : 220,
      bottom: 110
    }),
    [isDrawerOpen]
  );

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

  function workspaceRegionToTemplateRegion(region: WorkspaceRegion): TemplateRegion {
    return {
      ...region,
      isDirty: false
    };
  }

  function regionToWorkspaceRegion(region: TemplateRegion): WorkspaceRegion {
    return {
      id: region.id,
      name: region.name,
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
      windowIds: region.windowIds,
      color: region.color,
      createdAt: region.createdAt
    };
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

  function processMatchesDockApp(windowInfo: DetectedWindow, dockApp: DockApp): boolean {
    const expected = (dockApp.processName || dockApp.id).toLowerCase();
    const actual = windowInfo.processName.toLowerCase();
    return actual === expected || actual.includes(expected) || expected.includes(actual);
  }

  function placeVirtualWindowInRegion(windowInfo: VirtualWindowState, region: TemplateRegion, index: number): VirtualWindowState {
    return {
      ...windowInfo,
      virtualX: Math.round(region.x + 36 + (index % 4) * 42),
      virtualY: Math.round(region.y + 72 + (index % 4) * 34),
      initialVirtualX: Math.round(region.x + 36 + (index % 4) * 42),
      initialVirtualY: Math.round(region.y + 72 + (index % 4) * 34),
      isDirty: true
    };
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

  async function workInRealWindow(hwnd: string): Promise<void> {
    setError(null);
    try {
      const result = await window.infiniteDesk.workInWindow(hwnd);
      if (!result.success) {
        setError(result.error || 'Could not bring the real window forward.');
        return;
      }

      setMessage('Real window opened. InfiniteDesk was minimized so you can work in the app.');
    } catch (workError) {
      setError((workError as Error).message);
    }
  }

  async function controlRealWindow(hwnd: string, command: WindowCommand): Promise<void> {
    if (command === 'close') {
      const confirmed = window.confirm('Close this real Windows window? Unsaved work may prompt inside that app.');
      if (!confirmed) {
        return;
      }
    }

    setError(null);
    try {
      const result = await window.infiniteDesk.controlWindow(hwnd, command);
      if (!result.success) {
        setError(result.error || `Window command failed: ${command}.`);
        return;
      }

      setMessage(`Window command sent: ${command}.`);
      if (command === 'close' || command === 'minimize') {
        window.setTimeout(() => {
          void scanWindows();
        }, 450);
      }
    } catch (commandError) {
      setError((commandError as Error).message);
    }
  }

  async function embedRealWindow(windowInfo: VirtualWindowState, bounds: MoveEmbeddedWindowParams): Promise<void> {
    if (!windowInfo.hwnd) {
      return;
    }

    setError(null);
    try {
      const result = await window.infiniteDesk.embedWindowToHost({
        hwnd: windowInfo.hwnd,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      });

      if (!result.success) {
        setError(result.error || `Could not embed ${windowInfo.title}.`);
        return;
      }

      setEmbeddedWindowIds((current) => (current.includes(windowInfo.hwnd!) ? current : [...current, windowInfo.hwnd!]));
      setMessage(`Interactive control attached "${windowInfo.title}" inside its process node.`);
    } catch (embedError) {
      setError((embedError as Error).message);
    }
  }

  async function detachRealWindow(hwnd: string): Promise<void> {
    setError(null);
    try {
      const result = await window.infiniteDesk.detachEmbeddedWindow(hwnd);
      if (!result.success) {
        setError(result.error || 'Could not detach embedded window.');
        return;
      }

      setEmbeddedWindowIds((current) => current.filter((item) => item !== hwnd));
      setMessage('Detached interactive window.');
    } catch (detachError) {
      setError((detachError as Error).message);
    }
  }

  async function detachAllInteractiveWindows(): Promise<void> {
    if (embeddedWindowIds.length === 0) {
      setMessage('No interactive windows are attached.');
      return;
    }

    setError(null);
    const failedHwnds: string[] = [];
    const failedMessages: string[] = [];
    for (const hwnd of embeddedWindowIds) {
      try {
        const result = await window.infiniteDesk.detachEmbeddedWindow(hwnd);
        if (!result.success) {
          failedHwnds.push(hwnd);
          failedMessages.push(result.error || hwnd);
        }
      } catch (detachError) {
        failedHwnds.push(hwnd);
        failedMessages.push((detachError as Error).message);
      }
    }

    if (failedHwnds.length > 0) {
      const failedSet = new Set(failedHwnds);
      setEmbeddedWindowIds((current) => current.filter((hwnd) => failedSet.has(hwnd)));
      setError(`Could not detach ${failedHwnds.length} interactive windows. ${failedMessages.join(' ')}`);
      return;
    }

    setEmbeddedWindowIds([]);
    setMessage('Detached all interactive windows.');
  }

  async function moveEmbeddedWindow(params: MoveEmbeddedWindowParams): Promise<void> {
    try {
      await window.infiniteDesk.moveEmbeddedWindow(params);
    } catch {
      // Embedded movement is best-effort during drag and zoom; explicit detach still reports errors.
    }
  }

  async function syncDwmPreviews(previews: DwmPreviewWindow[]): Promise<void> {
    try {
      await window.infiniteDesk.syncDwmPreviews(previews);
    } catch {
      // DWM previews are best-effort visual overlays. Window control still works without them.
    }
  }

  async function clearDwmPreviews(): Promise<void> {
    try {
      await window.infiniteDesk.clearDwmPreviews();
    } catch {
      // Ignore cleanup errors; the host is also stopped by the main process on quit.
    }
  }

  async function toggleOverlayMode(): Promise<void> {
    const nextEnabled = !overlayModeEnabled;

    if (nextEnabled) {
      const confirmed = window.confirm(
        'Native Overlay keeps InfiniteDesk above real windows as a translucent control layer. Turn it on?'
      );
      if (!confirmed) {
        return;
      }
    }

    setError(null);
    try {
      const result = await window.infiniteDesk.setOverlayMode(nextEnabled);
      if (!result.success) {
        setError(result.error || 'Could not change Native Overlay mode.');
        return;
      }

      setOverlayModeEnabled(result.enabled);
      setMessage(
        result.enabled
          ? 'Native Overlay enabled. InfiniteDesk is now layered over real windows.'
          : 'Native Overlay disabled. InfiniteDesk returned to normal controller mode.'
      );
    } catch (overlayError) {
      setError((overlayError as Error).message);
    } finally {
      setIsBrandMenuOpen(false);
    }
  }

  async function quitInfiniteDesk(): Promise<void> {
    setError(null);
    try {
      await window.infiniteDesk.quitApp();
    } catch (quitError) {
      setError((quitError as Error).message);
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
    <main className={`immersive-shell theme-${themeMode} ${overlayModeEnabled ? 'overlay-mode' : ''}`}>
      <CanvasPreview
        windows={virtualWindows}
        regions={regions}
        previewLabel={canvasLabel}
        safeArea={canvasSafeArea}
        uiOverlayActive={isBrandMenuOpen || isDrawerOpen || isDockOverlayActive}
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

      <div className="floating-brand">
        <button className="brand-pill" onClick={() => setIsBrandMenuOpen((value) => !value)}>
          <Layers size={18} />
          <span>InfiniteDesk</span>
          <ChevronDown size={15} />
        </button>
        {isBrandMenuOpen ? (
          <div className="brand-menu">
            <button onClick={() => void scanWindows()}>
              <RefreshCw size={15} />
              Scan Windows
            </button>
            <button onClick={() => void saveRegions()}>
              <Save size={15} />
              Save Regions
            </button>
            <button onClick={() => void saveWorkspace()}>
              <BriefcaseBusiness size={15} />
              Save Workspace
            </button>
            <button onClick={() => void applyCanvasLayout()} disabled={virtualWindows.length === 0}>
              <Send size={15} />
              Apply Layout
            </button>
            <button onClick={resetLayoutEdits} disabled={dirtyCount === 0}>
              <RotateCcw size={15} />
              Reset Edits
            </button>
            <button onClick={() => void toggleOverlayMode()}>
              <LocateFixed size={15} />
              Native Overlay {overlayModeEnabled ? 'Off' : 'On'}
            </button>
            <button onClick={() => void detachAllInteractiveWindows()} disabled={embeddedWindowIds.length === 0}>
              <Box size={15} />
              Detach All Interactive
            </button>
            <button onClick={() => setIsDrawerOpen(true)}>
              <Menu size={15} />
              Details
            </button>
            <button onClick={toggleThemeMode}>
              <Palette size={15} />
              Theme: {themeMode === 'mist' ? 'Mist' : 'Graphite'}
            </button>
            <button className="danger-menu-action" onClick={() => void quitInfiniteDesk()}>
              <LogOut size={15} />
              Quit InfiniteDesk
            </button>
          </div>
        ) : null}
      </div>

      <div className="floating-view-controls">
        <button title="Zoom out" onClick={() => setZoomOutSignal((value) => value + 1)}>
          <Minus size={15} />
        </button>
        <span>{Math.round(zoomScale * 100)}%</span>
        <button title="Zoom in" onClick={() => setZoomInSignal((value) => value + 1)}>
          <Plus size={15} />
        </button>
        <button onClick={() => setFitSignal((value) => value + 1)}>Fit</button>
        <button onClick={() => setIsDrawerOpen((value) => !value)}>{isDrawerOpen ? 'Close' : 'Details'}</button>
      </div>

      <button className={`overlay-mode-pill ${overlayModeEnabled ? 'enabled' : ''}`} onClick={() => void toggleOverlayMode()}>
        <LocateFixed size={14} />
        Native Overlay: {overlayModeEnabled ? 'On' : 'Off'}
      </button>

      <button className="interactive-control-pill enabled" onClick={() => setIsDrawerOpen(true)}>
        <Box size={14} />
        Interactive Control: On
      </button>

      <button className="floating-help-button" onClick={() => setIsDrawerOpen(true)} title="Show shortcuts and workflow help">
        ?
      </button>

      {selectedRegion ? <div className="active-region-pill">Active Region: {selectedRegion.name}</div> : null}

      {error ? <div className="floating-error">{error}</div> : null}

      <Dock
        apps={dockApps}
        pinnedApps={defaultDockApps}
        launchingAppId={launchingAppId}
        isLoadingApps={isLoadingDockApps}
        onLaunch={(dockApp) => void launchDockApp(dockApp)}
        onOverlayActiveChange={setIsDockOverlayActive}
      />

      <aside className={`floating-drawer immersive-drawer ${isDrawerOpen ? 'open' : ''}`}>
        <section className="side-section status-panel">
          <h2>Status</h2>
          <p>{message}</p>
          <p>
            {restorableCount} restorable windows - {regions.length} regions - {dirtyCount} edits
          </p>
          <p>
            {workspaces.length} saved workspaces - {templates.length} saved templates
          </p>
          <p>
            Native Overlay is {overlayModeEnabled ? 'On: InfiniteDesk is layered over real windows.' : 'Off: InfiniteDesk is a normal controller window.'}
          </p>
          <p>
            Interactive Control is always on: {embeddedWindowIds.length} windows attached.
          </p>
          <div className="shortcut-list">
            <strong>Workflow</strong>
            <span>Native Overlay makes InfiniteDesk a translucent layer above real windows.</span>
            <span>Interactive Control attaches real app windows inside process nodes for direct click, type, and scroll input.</span>
            <span>Select a region, then launch apps from the Dock to place them there.</span>
            <span>Ctrl+Drag on empty canvas creates a Template Region.</span>
            <span>Drag a region to move its assigned windows together.</span>
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

        <section className="side-section">
          <div className="section-heading">
            <h2>Interactive Control</h2>
            <span>{attachedInteractiveWindows.length}</span>
          </div>
          <div className="interactive-control-panel">
            <div className="interactive-control-status">Interactive Control is always on.</div>
            <button className="secondary-button fill-button danger-inline-action" onClick={() => void detachAllInteractiveWindows()} disabled={attachedInteractiveWindows.length === 0}>
              Detach All
            </button>
            {attachedInteractiveWindows.length === 0 ? (
              <div className="empty-state">No interactive windows attached.</div>
            ) : (
              <div className="interactive-window-list">
                {attachedInteractiveWindows.map((windowInfo) => (
                  <article className="interactive-window-card" key={windowInfo.hwnd}>
                    <div>
                      <strong>{windowInfo.title}</strong>
                      <span>{windowInfo.processName}</span>
                      <em>{windowInfo.note}</em>
                    </div>
                    <button title="Detach interactive window" onClick={() => void detachRealWindow(windowInfo.hwnd)}>
                      Detach
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="side-section">
          <div className="section-heading">
            <h2>Regions</h2>
            <span>{regions.length}</span>
          </div>
          <div className="region-list">
            {regions.length === 0 ? (
              <div className="empty-state">Ctrl+Drag on the canvas to create a region.</div>
            ) : (
              regions.map((region) => (
                <article className={`region-list-item ${selectedRegionId === region.id ? 'active' : ''}`} key={region.id}>
                  <strong>{region.name}</strong>
                  <span>{region.windowIds.length} windows</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="side-section">
          <div className="section-heading">
            <h2>Workspaces</h2>
            <span>{workspaces.length}</span>
          </div>
          <div className="template-list">
            {workspaces.length === 0 ? (
              <div className="empty-state">No saved workspaces.</div>
            ) : (
              workspaces.map((workspace) => (
                <article className="template-card" key={workspace.id}>
                  <div>
                    <h3>{workspace.name}</h3>
                    <p>
                      {workspace.windows.length} windows - {workspace.regions.length} regions
                    </p>
                  </div>
                  <div className="template-actions">
                    <button title="Load workspace on canvas" onClick={() => previewWorkspaceOnCanvas(workspace)}>
                      <Eye size={16} />
                    </button>
                    <button title="Restore workspace" onClick={() => void restoreWorkspace(workspace)}>
                      <Undo2 size={16} />
                    </button>
                    <button title="Delete workspace" onClick={() => void deleteWorkspace(workspace)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="side-section">
          <div className="section-heading">
            <h2>Saved Templates</h2>
            <span>{templates.length}</span>
          </div>
          <div className="template-list">
            {templates.length === 0 ? (
              <div className="empty-state">No saved templates.</div>
            ) : (
              templates.map((template) => (
                <article className="template-card" key={template.id}>
                  <div>
                    <h3>{template.name}</h3>
                    <p>{template.windows.length} windows</p>
                  </div>
                  <div className="template-actions">
                    <button title="Preview as region" onClick={() => previewTemplateOnCanvas(template)}>
                      <Eye size={16} />
                    </button>
                    <button title="Restore template" onClick={() => void restoreTemplate(template)}>
                      <Undo2 size={16} />
                    </button>
                    <button title="Delete template" onClick={() => void deleteTemplate(template)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
