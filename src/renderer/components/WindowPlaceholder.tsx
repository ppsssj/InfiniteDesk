import React from 'react';

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

export function WindowPlaceholder({ processName }: { processName: string }): React.JSX.Element {
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
