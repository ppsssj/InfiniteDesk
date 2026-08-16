import React from 'react';
import { LogOut, Menu, Palette, RefreshCw } from 'lucide-react';
import logoMarkUrl from '../assets/logo-mark.png';

type BrandMenuProps = {
  isOpen: boolean;
  onToggle: () => void;
  onScan: () => void;
  onOpenDetails: () => void;
  onToggleTheme: () => void;
  themeMode: 'mist' | 'graphite';
  onQuit: () => void;
};

export function BrandMenu({
  isOpen,
  onToggle,
  onScan,
  onOpenDetails,
  onToggleTheme,
  themeMode,
  onQuit
}: BrandMenuProps): React.JSX.Element {
  return (
    <div className="floating-brand" data-dwm-ui-overlay="true">
      <button className="brand-pill" title="InfiniteDesk menu" aria-label="InfiniteDesk menu" onClick={onToggle}>
        <img className="brand-logo-mark" src={logoMarkUrl} alt="" />
      </button>
      {isOpen ? (
        <div className="brand-menu" data-dwm-ui-overlay="true">
          <button onClick={onScan}>
            <RefreshCw size={15} />
            Scan Windows
          </button>
          <button onClick={onOpenDetails}>
            <Menu size={15} />
            Details
          </button>
          <button onClick={onToggleTheme}>
            <Palette size={15} />
            Theme: {themeMode === 'mist' ? 'Mist' : 'Graphite'}
          </button>
          <button className="danger-menu-action" onClick={onQuit}>
            <LogOut size={15} />
            Quit InfiniteDesk
          </button>
        </div>
      ) : null}
    </div>
  );
}
