import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, ChevronDown, Eye, Layers, LocateFixed, Menu, Minus, Plus, Power, RefreshCw, RotateCcw, Save, Send, Trash2, Undo2, X } from 'lucide-react';
import type { DetectedWindow, DockApp, DwmPreviewWindow, LayoutTemplate, MoveEmbeddedWindowParams, RestoreResult, WindowCommand } from '../shared/types';
import { createRegionFromTemplate, getWindowIdentity, getWindowsForRegion, updateRegionMembership } from './canvas/regions';
import { createInitialVirtualLayout, toVirtualWindow } from './canvas/windows';
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

function App(): React.JSX.Element {
  const [windows, setWindows] = useState<DetectedWindow[]>([]);
  const [virtualWindows, setVirtualWindows] = useState<VirtualWindowState[]>([]);
  const [initialVirtualWindows, setInitialVirtualWindows] = useState<VirtualWindowState[]>([]);
  const [regions, setRegions] = useState<TemplateRegion[]>([]);
  const [templates, setTemplates] = useState<LayoutTemplate[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isBrandMenuOpen, setIsBrandMenuOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [message, setMessage] = useState('Scan Windows to start. Then Ctrl+Drag on the canvas to create a template region.');
  const [error, setError] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<LayoutTemplate | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [resetViewSignal, setResetViewSignal] = useState(0);
  const [zoomInSignal, setZoomInSignal] = useState(0);
  const [zoomOutSignal, setZoomOutSignal] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  const [launchingAppId, setLaunchingAppId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [liveControlEnabled, setLiveControlEnabled] = useState(false);
  const [overlayModeEnabled, setOverlayModeEnabled] = useState(false);
  const [experimentalEmbedEnabled, setExperimentalEmbedEnabled] = useState(false);
  const [embeddedWindowIds, setEmbeddedWindowIds] = useState<string[]>([]);

  const canvasLabel = previewTemplate
    ? `Previewing template: ${previewTemplate.name}`
    : `${virtualWindows.length} windows - ${regions.length} regions`;
  const dirtyCount = virtualWindows.filter((windowInfo) => windowInfo.isDirty).length + regions.filter((region) => region.isDirty).length;
  const restorableCount = useMemo(() => windows.filter((windowInfo) => windowInfo.isRestorable && !windowInfo.isInternal).length, [windows]);
  const selectedRegion = selectedRegionId ? regions.find((region) => region.id === selectedRegionId) || null : null;

  async function loadTemplates(): Promise<void> {
    const loaded = await window.infiniteDesk.listTemplates();
    setTemplates(loaded);
  }

  function loadVirtualLayout(nextWindows: VirtualWindowState[], nextRegions: TemplateRegion[], template: LayoutTemplate | null): void {
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

  async function moveLiveWindow(windowInfo: VirtualWindowState): Promise<void> {
    if (!windowInfo.hwnd) {
      return;
    }

    try {
      const result = await window.infiniteDesk.moveWindow(virtualWindowToDetected(windowInfo));
      if (!result.success) {
        setError(result.error || `Could not move ${windowInfo.title}.`);
      }
    } catch (moveError) {
      setError((moveError as Error).message);
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
      setMessage(`Embedded "${windowInfo.title}" into its process node.`);
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
      setMessage('Detached embedded window.');
    } catch (detachError) {
      setError((detachError as Error).message);
    }
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

  function toggleExperimentalEmbedMode(): void {
    if (experimentalEmbedEnabled) {
      setExperimentalEmbedEnabled(false);
      setMessage('Experimental Embed Mode disabled. Existing embedded windows can still be detached from their nodes.');
      return;
    }

    const confirmed = window.confirm(
      'Experimental Embed Mode uses Win32 SetParent to attach external app windows into InfiniteDesk. Some apps can behave incorrectly. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setExperimentalEmbedEnabled(true);
    setMessage('Experimental Embed Mode enabled. Use Embed on a process node to test real app content inside it.');
  }

  function toggleLiveControl(): void {
    if (liveControlEnabled) {
      setLiveControlEnabled(false);
      setMessage('Live Control disabled. Dragging is virtual-only.');
      return;
    }

    const confirmed = window.confirm('Live Control moves real Windows windows immediately. Turn it on?');
    if (!confirmed) {
      return;
    }

    setLiveControlEnabled(true);
    setMessage('Live Control enabled. Dragging frames moves real windows immediately.');
  }

  async function toggleOverlayMode(): Promise<void> {
    const nextEnabled = !overlayModeEnabled;

    if (nextEnabled) {
      const confirmed = window.confirm(
        'Native Overlay keeps InfiniteDesk above real windows and enables Live Control. Dragging frames will move real Windows windows immediately.'
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
      setLiveControlEnabled(result.enabled);
      setMessage(
        result.enabled
          ? 'Native Overlay enabled. InfiniteDesk is now a live control layer over real windows.'
          : 'Native Overlay disabled. InfiniteDesk returned to normal controller mode.'
      );
    } catch (overlayError) {
      setError((overlayError as Error).message);
    } finally {
      setIsBrandMenuOpen(false);
    }
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

  async function deleteTemplate(template: LayoutTemplate): Promise<void> {
    await window.infiniteDesk.deleteTemplate(template.id);
    if (previewTemplate?.id === template.id) {
      setPreviewTemplate(null);
    }
    await loadTemplates();
    setMessage(`Deleted "${template.name}".`);
  }

  function previewTemplateOnCanvas(template: LayoutTemplate): void {
    const { region, windows: templateWindows } = createRegionFromTemplate(template);
    loadVirtualLayout(templateWindows, region ? [region] : [], template);
    setIsDrawerOpen(false);
    setMessage(`Previewing template "${template.name}". Region bounds were created around saved windows.`);
  }

  function resetLayoutEdits(): void {
    setVirtualWindows(initialVirtualWindows.map((windowInfo) => ({ ...windowInfo, isDirty: false })));
    setRegions((current) => updateRegionMembership(initialVirtualWindows, current.map((region) => ({ ...region, isDirty: false }))));
    setMessage('Canvas layout edits were reset.');
    setIsBrandMenuOpen(false);
  }

  useEffect(() => {
    void loadTemplates();
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
  }, [virtualWindows, regions, overlayModeEnabled, liveControlEnabled]);

  return (
    <main className={`immersive-shell ${overlayModeEnabled ? 'overlay-mode' : ''}`}>
      <CanvasPreview
        windows={virtualWindows}
        regions={regions}
        previewLabel={canvasLabel}
        selectedRegionId={selectedRegionId}
        liveControlEnabled={liveControlEnabled}
        experimentalEmbedEnabled={experimentalEmbedEnabled}
        embeddedWindowIds={embeddedWindowIds}
        onWindowsChange={setVirtualWindows}
        onRegionsChange={setRegions}
        onSelectRegion={setSelectedRegionId}
        onLiveMoveWindow={(windowInfo) => void moveLiveWindow(windowInfo)}
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
            <button onClick={() => void applyCanvasLayout()} disabled={virtualWindows.length === 0}>
              <Send size={15} />
              Apply Layout
            </button>
            <button onClick={resetLayoutEdits} disabled={dirtyCount === 0}>
              <RotateCcw size={15} />
              Reset Edits
            </button>
            <button onClick={toggleLiveControl}>
              <Power size={15} />
              Live Control {liveControlEnabled ? 'Off' : 'On'}
            </button>
            <button onClick={() => void toggleOverlayMode()}>
              <LocateFixed size={15} />
              Native Overlay {overlayModeEnabled ? 'Off' : 'On'}
            </button>
            <button onClick={toggleExperimentalEmbedMode}>
              <Box size={15} />
              Experimental Embed {experimentalEmbedEnabled ? 'Off' : 'On'}
            </button>
            <button onClick={() => setIsDrawerOpen(true)}>
              <Menu size={15} />
              Details
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

      <button className={`live-control-pill ${liveControlEnabled ? 'enabled' : ''}`} onClick={toggleLiveControl}>
        <Power size={14} />
        Live Control: {liveControlEnabled ? 'On' : 'Off'}
      </button>

      <button className={`overlay-mode-pill ${overlayModeEnabled ? 'enabled' : ''}`} onClick={() => void toggleOverlayMode()}>
        <LocateFixed size={14} />
        Native Overlay: {overlayModeEnabled ? 'On' : 'Off'}
      </button>

      <button className={`experimental-embed-pill ${experimentalEmbedEnabled ? 'enabled' : ''}`} onClick={toggleExperimentalEmbedMode}>
        <Box size={14} />
        Experimental Embed: {experimentalEmbedEnabled ? 'On' : 'Off'}
      </button>

      <button className="floating-help-button" onClick={() => setIsDrawerOpen(true)} title="Show shortcuts and workflow help">
        ?
      </button>

      {selectedRegion ? <div className="active-region-pill">Active Region: {selectedRegion.name}</div> : null}

      {error ? <div className="floating-error">{error}</div> : null}

      <Dock apps={defaultDockApps} launchingAppId={launchingAppId} onLaunch={(dockApp) => void launchDockApp(dockApp)} />

      <aside className={`floating-drawer immersive-drawer ${isDrawerOpen ? 'open' : ''}`}>
        <section className="side-section status-panel">
          <h2>Status</h2>
          <p>{message}</p>
          <p>
            {restorableCount} restorable windows - {regions.length} regions - {dirtyCount} edits
          </p>
          <p>
            Live Control is {liveControlEnabled ? 'On: dragging frames moves real windows immediately.' : 'Off: dragging is virtual until Apply Layout.'}
          </p>
          <p>
            Native Overlay is {overlayModeEnabled ? 'On: InfiniteDesk is layered over real windows.' : 'Off: InfiniteDesk is a normal controller window.'}
          </p>
          <p>
            Experimental Embed is {experimentalEmbedEnabled ? `On: ${embeddedWindowIds.length} windows embedded.` : 'Off: external windows are not reparented.'}
          </p>
          <div className="shortcut-list">
            <strong>Workflow</strong>
            <span>Native Overlay + Live Control is the main path for controlling real Windows windows.</span>
            <span>Experimental Embed attempts to place real app windows inside process nodes with Win32 SetParent.</span>
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
