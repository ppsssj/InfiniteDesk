import React from 'react';
import type { DockApp } from '../../shared/types';

type DockProps = {
  apps: DockApp[];
  launchingAppId: string | null;
  onLaunch: (app: DockApp) => void;
};

export function Dock({ apps, launchingAppId, onLaunch }: DockProps): React.JSX.Element {
  return (
    <nav className="dock" aria-label="Application Dock">
      {apps.map((app) => (
        <button
          className={`dock-item ${launchingAppId === app.id ? 'launching' : ''}`}
          key={app.id}
          onClick={() => onLaunch(app)}
          title={app.name}
          disabled={launchingAppId === app.id}
        >
          <span>{app.icon || app.name.slice(0, 2).toUpperCase()}</span>
        </button>
      ))}
    </nav>
  );
}
