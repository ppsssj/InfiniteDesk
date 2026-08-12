import React from 'react';
import { BriefcaseBusiness, LocateFixed, LogOut, Menu, Palette, RefreshCw, RotateCcw, Save, Send } from 'lucide-react';
import logoMarkUrl from '../assets/logo-mark.png';

type BrandMenuProps = {
  isOpen: boolean;
  onToggle: () => void;
  onScan: () => void;
  onSaveRegions: () => void;
  onSaveWorkspace: () => void;
  onApplyLayout: () => void;
  applyDisabled: boolean;
  onResetEdits: () => void;
  resetDisabled: boolean;
  onToggleOverlay: () => void;
  overlayModeEnabled: boolean;
  onOpenDetails: () => void;
  onToggleTheme: () => void;
  themeMode: 'mist' | 'graphite';
  onQuit: () => void;
};

export function BrandMenu({
  isOpen,
  onToggle,
  onScan,
  onSaveRegions,
  onSaveWorkspace,
  onApplyLayout,
  applyDisabled,
  onResetEdits,
  resetDisabled,
  onToggleOverlay,
  overlayModeEnabled,
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
          <button onClick={onSaveRegions}>
            <Save size={15} />
            Save Regions
          </button>
          <button onClick={onSaveWorkspace}>
            <BriefcaseBusiness size={15} />
            Save Workspace
          </button>
          <button onClick={onApplyLayout} disabled={applyDisabled}>
            <Send size={15} />
            Apply Layout
          </button>
          <button onClick={onResetEdits} disabled={resetDisabled}>
            <RotateCcw size={15} />
            Reset Edits
          </button>
          <button onClick={onToggleOverlay}>
            <LocateFixed size={15} />
            Native Overlay {overlayModeEnabled ? 'Off' : 'On'}
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
