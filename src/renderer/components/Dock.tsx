import React from 'react';
import { ChevronDown, ChevronUp, Crosshair, Grid3X3, Pin, PinOff, Search, X } from 'lucide-react';
import type { DockApp } from '../../shared/types';
import type { VirtualWindowState } from '../canvas/types';
import { getWindowKey } from './CanvasPreview.helpers';

type DockProps = {
  apps: DockApp[];
  pinnedApps: DockApp[];
  defaultPinnedAppIds: string[];
  runningWindows: VirtualWindowState[];
  selectedWindowKeys: string[];
  activityWindowHwnds: string[];
  statusLabel: string;
  launchingAppId: string | null;
  isLoadingApps: boolean;
  closeSignal: number;
  onLaunch: (app: DockApp) => void;
  onPinApp: (app: DockApp) => void;
  onUnpinApp: (app: DockApp) => void;
  onSelectWindow: (windowInfo: VirtualWindowState, index: number) => void;
  onFocusWindow: (windowInfo: VirtualWindowState) => void;
  onZoomWindow: (windowInfo: VirtualWindowState, index: number) => void;
  onRemoveWindow: (windowInfo: VirtualWindowState, index: number) => void;
  onCloseWindow: (windowInfo: VirtualWindowState) => void;
  onOverlayActiveChange: (active: boolean) => void;
};

type DockMenuState =
  | { type: 'app'; x: number; y: number; app: DockApp }
  | { type: 'window'; x: number; y: number; windowInfo: VirtualWindowState; index: number };

const RUNNING_WINDOW_PAGE_SIZE = 4;
const UWP_HOST_PROCESS = 'applicationframehost';

function getAppInitials(app: DockApp): string {
  return app.icon || app.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'AP';
}

function AppIcon({ app, iconDataUrl }: { app: DockApp; iconDataUrl?: string }): React.JSX.Element {
  if (iconDataUrl || app.iconDataUrl) {
    return <img src={iconDataUrl || app.iconDataUrl} alt="" />;
  }

  return <span>{getAppInitials(app)}</span>;
}

function getWindowDisplayName(windowInfo: VirtualWindowState): string {
  const processName = windowInfo.processName.trim();
  if (processName.toLowerCase() === UWP_HOST_PROCESS && windowInfo.title.trim().length > 0) {
    return windowInfo.title.trim();
  }

  return processName || windowInfo.title || 'Window';
}

function getWindowInitials(windowInfo: VirtualWindowState): string {
  return getWindowDisplayName(windowInfo)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'WN';
}

export function Dock({
  apps,
  pinnedApps,
  defaultPinnedAppIds,
  runningWindows,
  selectedWindowKeys,
  activityWindowHwnds,
  statusLabel,
  launchingAppId,
  isLoadingApps,
  closeSignal,
  onLaunch,
  onPinApp,
  onUnpinApp,
  onSelectWindow,
  onFocusWindow,
  onZoomWindow,
  onRemoveWindow,
  onCloseWindow,
  onOverlayActiveChange
}: DockProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [isAllAppsOpen, setIsAllAppsOpen] = React.useState(false);
  const [menu, setMenu] = React.useState<DockMenuState | null>(null);
  const [runningWindowStartIndex, setRunningWindowStartIndex] = React.useState(0);
  const lastRunningWindowWheelAtRef = React.useRef(0);
  const normalizedQuery = query.trim().toLowerCase();
  const defaultPinnedAppIdSet = React.useMemo(() => new Set(defaultPinnedAppIds), [defaultPinnedAppIds]);
  const pinnedAppKeySet = React.useMemo(
    () => new Set(pinnedApps.map((app) => `${app.name.toLowerCase()}|${app.executablePath.toLowerCase()}`)),
    [pinnedApps]
  );
  const selectedWindowKeySet = React.useMemo(() => new Set(selectedWindowKeys), [selectedWindowKeys]);
  const selectedWindowHwndSet = React.useMemo(
    () =>
      new Set(
        selectedWindowKeys
          .filter((key) => key.toLowerCase().startsWith('0x'))
          .map((key) => key.toLowerCase())
      ),
    [selectedWindowKeys]
  );
  const activityWindowHwndSet = React.useMemo(
    () => new Set(activityWindowHwnds.map((hwnd) => hwnd.toLowerCase())),
    [activityWindowHwnds]
  );
  const processIconByName = React.useMemo(() => {
    const icons = new Map<string, string>();
    for (const app of apps) {
      if (!app.iconDataUrl) {
        continue;
      }

      const processName = app.processName?.toLowerCase();
      if (processName && !icons.has(processName)) {
        icons.set(processName, app.iconDataUrl);
      }

      const name = app.name.toLowerCase();
      if (!icons.has(name)) {
        icons.set(name, app.iconDataUrl);
      }
    }
    return icons;
  }, [apps]);
  const searchResults = React.useMemo(() => {
    if (normalizedQuery.length === 0) {
      return isAllAppsOpen ? apps : [];
    }

    return apps
      .filter((app) => `${app.name} ${app.processName || ''} ${app.executablePath}`.toLowerCase().includes(normalizedQuery));
  }, [apps, isAllAppsOpen, normalizedQuery]);
  const shouldShowResults = normalizedQuery.length > 0 || isAllAppsOpen;
  const isMenuOpen = menu !== null;
  const maxRunningWindowStartIndex = Math.max(
    0,
    Math.ceil(runningWindows.length / RUNNING_WINDOW_PAGE_SIZE) * RUNNING_WINDOW_PAGE_SIZE - RUNNING_WINDOW_PAGE_SIZE
  );
  const visibleRunningWindowEntries = React.useMemo(
    () =>
      runningWindows
        .slice(runningWindowStartIndex, runningWindowStartIndex + RUNNING_WINDOW_PAGE_SIZE)
        .map((windowInfo, offset) => ({ windowInfo, index: runningWindowStartIndex + offset })),
    [runningWindowStartIndex, runningWindows]
  );

  React.useEffect(() => {
    onOverlayActiveChange(shouldShowResults || isMenuOpen);
    return () => onOverlayActiveChange(false);
  }, [isMenuOpen, onOverlayActiveChange, shouldShowResults]);

  React.useEffect(() => {
    setQuery('');
    setIsAllAppsOpen(false);
    setMenu(null);
  }, [closeSignal]);

  React.useEffect(() => {
    setRunningWindowStartIndex((current) => Math.min(current, maxRunningWindowStartIndex));
  }, [maxRunningWindowStartIndex]);

  React.useEffect(() => {
    function closeMenu(): void {
      setMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setMenu(null);
      }
    }

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  function isPinned(app: DockApp): boolean {
    return pinnedAppKeySet.has(`${app.name.toLowerCase()}|${app.executablePath.toLowerCase()}`);
  }

  function getDockAppIconDataUrl(app: DockApp): string | undefined {
    return app.iconDataUrl || processIconByName.get(app.processName?.toLowerCase() || '') || processIconByName.get(app.name.toLowerCase());
  }

  function getWindowIconDataUrl(windowInfo: VirtualWindowState): string | undefined {
    const processName = windowInfo.processName.toLowerCase();
    const title = windowInfo.title.toLowerCase();
    if (processName === UWP_HOST_PROCESS) {
      return title.includes('settings') || title.includes('설정')
        ? processIconByName.get('systemsettings') || processIconByName.get('settings')
        : processIconByName.get(title);
    }

    return processIconByName.get(processName) || processIconByName.get(title);
  }

  function canUnpin(app: DockApp): boolean {
    return !defaultPinnedAppIdSet.has(app.id);
  }

  function openAppMenu(event: React.MouseEvent<HTMLElement>, app: DockApp): void {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      type: 'app',
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 160),
      app
    });
  }

  function openWindowMenu(event: React.MouseEvent<HTMLElement>, windowInfo: VirtualWindowState, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      type: 'window',
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 210),
      windowInfo,
      index
    });
  }

  function runMenuAction(action: () => void): void {
    setMenu(null);
    action();
  }

  function showPreviousRunningWindows(): void {
    setRunningWindowStartIndex((current) => Math.max(0, current - RUNNING_WINDOW_PAGE_SIZE));
  }

  function showNextRunningWindows(): void {
    setRunningWindowStartIndex((current) => Math.min(maxRunningWindowStartIndex, current + RUNNING_WINDOW_PAGE_SIZE));
  }

  function handleRunningWindowWheel(event: React.WheelEvent<HTMLDivElement>): void {
    if (maxRunningWindowStartIndex === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const now = window.performance.now();
    if (now - lastRunningWindowWheelAtRef.current < 180) {
      return;
    }

    lastRunningWindowWheelAtRef.current = now;
    if (event.deltaY > 0 || event.deltaX > 0) {
      showNextRunningWindows();
    } else if (event.deltaY < 0 || event.deltaX < 0) {
      showPreviousRunningWindows();
    }
  }

  return (
    <div className="dock-launcher" data-dwm-ui-overlay="true">
      <div className="dock-status">{statusLabel}</div>
      <div className="dock-search">
        <Search size={15} />
        <input
          aria-label="Search installed apps"
          placeholder={isLoadingApps ? 'Loading apps...' : `Search ${apps.length} apps`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (event.target.value.trim().length > 0) {
              setIsAllAppsOpen(false);
            }
          }}
        />
        <button
          className={`dock-all-apps-button ${isAllAppsOpen ? 'active' : ''}`}
          title="Show all apps"
          onClick={() => {
            setMenu(null);
            setQuery('');
            setIsAllAppsOpen((value) => !value);
          }}
        >
          <Grid3X3 size={14} />
        </button>
        {query.length > 0 ? (
          <button title="Clear search" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        ) : (
          <span className="dock-search-spacer" />
        )}
      </div>

      {shouldShowResults ? (
        <div className="dock-results">
          {searchResults.length === 0 ? (
            <div className="dock-empty-result">No apps found.</div>
          ) : (
            searchResults.map((app) => (
              <button
                className={`dock-result-item ${isPinned(app) ? 'pinned' : ''}`}
                key={app.id}
                onClick={() => {
                  setQuery('');
                  setIsAllAppsOpen(false);
                  setMenu(null);
                  onLaunch(app);
                }}
                onContextMenu={(event) => openAppMenu(event, app)}
                disabled={launchingAppId === app.id}
                title={app.executablePath}
              >
                <div className="dock-app-icon">
                  <AppIcon app={app} iconDataUrl={getDockAppIconDataUrl(app)} />
                </div>
                <strong>{app.name}</strong>
                {isPinned(app) ? <Pin size={12} /> : null}
              </button>
            ))
          )}
        </div>
      ) : null}

      {menu ? (
        <div
          className="dock-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {menu.type === 'app' ? (
            isPinned(menu.app) && canUnpin(menu.app) ? (
              <button onClick={() => runMenuAction(() => onUnpinApp(menu.app))}>
                <PinOff size={13} />
                Unpin from Dock
              </button>
            ) : isPinned(menu.app) ? (
              <button disabled>
                <Pin size={13} />
                Pinned
              </button>
            ) : (
              <button onClick={() => runMenuAction(() => onPinApp(menu.app))}>
                <Pin size={13} />
                Pin to Dock
              </button>
            )
          ) : (
            <>
              <button onClick={() => runMenuAction(() => onSelectWindow(menu.windowInfo, menu.index))}>
                <Crosshair size={13} />
                Select
              </button>
              {menu.windowInfo.hwnd ? (
                <button onClick={() => runMenuAction(() => onFocusWindow(menu.windowInfo))}>Focus Real Window</button>
              ) : null}
              <button onClick={() => runMenuAction(() => onZoomWindow(menu.windowInfo, menu.index))}>Zoom to Window</button>
              <button onClick={() => runMenuAction(() => onRemoveWindow(menu.windowInfo, menu.index))}>Remove from Canvas</button>
              {menu.windowInfo.hwnd ? (
                <button onClick={() => runMenuAction(() => onCloseWindow(menu.windowInfo))}>Close Real Window</button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {runningWindows.length > 0 ? (
        <div className="running-window-pager" onWheel={handleRunningWindowWheel}>
          <div className="running-window-strip" aria-label="Running windows">
            {visibleRunningWindowEntries.map(({ windowInfo, index }) => {
              const key = getWindowKey(windowInfo, index);
              const isSelected = selectedWindowKeySet.has(key) || Boolean(windowInfo.hwnd && selectedWindowHwndSet.has(windowInfo.hwnd.toLowerCase()));
              const hasActivity = Boolean(windowInfo.hwnd && activityWindowHwndSet.has(windowInfo.hwnd.toLowerCase()));
              const windowIconDataUrl = getWindowIconDataUrl(windowInfo);
              const displayName = getWindowDisplayName(windowInfo);
              return (
                <button
                  className={`running-window-chip ${isSelected ? 'selected' : ''} ${hasActivity ? 'activity' : ''}`}
                  key={key}
                  title={`${windowInfo.title} - ${displayName}`}
                  onClick={() => onSelectWindow(windowInfo, index)}
                  onDoubleClick={() => onFocusWindow(windowInfo)}
                  onContextMenu={(event) => openWindowMenu(event, windowInfo, index)}
                >
                  {windowIconDataUrl ? (
                    <img className="running-window-logo" src={windowIconDataUrl} alt="" />
                  ) : (
                    <span className="running-window-icon">{getWindowInitials(windowInfo)}</span>
                  )}
                  <span className="running-window-text">
                    <strong>{displayName}</strong>
                    <em>{windowInfo.title}</em>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="running-window-scroll-buttons" aria-label="Running window pages">
            <button
              type="button"
              title="Previous running windows"
              onClick={showPreviousRunningWindows}
              disabled={runningWindowStartIndex === 0}
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              title="Next running windows"
              onClick={showNextRunningWindows}
              disabled={runningWindowStartIndex >= maxRunningWindowStartIndex}
            >
              <ChevronDown size={12} />
            </button>
          </div>
        </div>
      ) : null}

      <nav className="dock" aria-label="Application Dock">
        {pinnedApps.map((app) => (
          <button
            className={`dock-item ${launchingAppId === app.id ? 'launching' : ''}`}
            key={app.id}
            onClick={() => onLaunch(app)}
            onContextMenu={(event) => openAppMenu(event, app)}
            title={app.name}
            disabled={launchingAppId === app.id}
          >
            <AppIcon app={app} iconDataUrl={getDockAppIconDataUrl(app)} />
          </button>
        ))}
      </nav>
    </div>
  );
}
