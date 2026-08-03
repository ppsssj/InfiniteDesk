import React from 'react';
import { Grid3X3, Search, X } from 'lucide-react';
import type { DockApp } from '../../shared/types';

type DockProps = {
  apps: DockApp[];
  pinnedApps: DockApp[];
  statusLabel: string;
  launchingAppId: string | null;
  isLoadingApps: boolean;
  onLaunch: (app: DockApp) => void;
  onOverlayActiveChange: (active: boolean) => void;
};

function getAppInitials(app: DockApp): string {
  return app.icon || app.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'AP';
}

function AppIcon({ app }: { app: DockApp }): React.JSX.Element {
  if (app.iconDataUrl) {
    return <img src={app.iconDataUrl} alt="" />;
  }

  return <span>{getAppInitials(app)}</span>;
}

export function Dock({ apps, pinnedApps, statusLabel, launchingAppId, isLoadingApps, onLaunch, onOverlayActiveChange }: DockProps): React.JSX.Element {
  const [query, setQuery] = React.useState('');
  const [isAllAppsOpen, setIsAllAppsOpen] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = React.useMemo(() => {
    if (normalizedQuery.length === 0) {
      return isAllAppsOpen ? apps : [];
    }

    return apps
      .filter((app) => `${app.name} ${app.processName || ''} ${app.executablePath}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 24);
  }, [apps, isAllAppsOpen, normalizedQuery]);
  const shouldShowResults = normalizedQuery.length > 0 || isAllAppsOpen;

  React.useEffect(() => {
    onOverlayActiveChange(shouldShowResults || isExpanded);
    return () => onOverlayActiveChange(false);
  }, [isExpanded, onOverlayActiveChange, shouldShowResults]);

  return (
    <div
      className={`dock-launcher ${isExpanded ? 'expanded' : ''}`}
      data-dwm-ui-overlay="true"
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) {
          setIsExpanded(false);
        }
      }}
      onFocusCapture={() => setIsExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsExpanded(false);
        }
      }}
    >
      <div className="dock-reveal-handle" aria-hidden="true" />
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
                className="dock-result-item"
                key={app.id}
                onClick={() => {
                  setQuery('');
                  onLaunch(app);
                }}
                disabled={launchingAppId === app.id}
                title={app.executablePath}
              >
                <div className="dock-app-icon">
                  <AppIcon app={app} />
                </div>
                <strong>{app.name}</strong>
              </button>
            ))
          )}
        </div>
      ) : null}

      <nav className="dock" aria-label="Application Dock">
        {pinnedApps.map((app) => (
          <button
            className={`dock-item ${launchingAppId === app.id ? 'launching' : ''}`}
            key={app.id}
            onClick={() => onLaunch(app)}
            title={app.name}
            disabled={launchingAppId === app.id}
          >
            <AppIcon app={app} />
          </button>
        ))}
      </nav>
    </div>
  );
}
