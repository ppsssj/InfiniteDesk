import type { CanvasSafeArea } from '../canvas/transform';
import type { TemplateRegion, VirtualWindowState } from '../canvas/types';
import type { DwmPreviewWindow, MoveEmbeddedWindowParams, RelayPointerInput, WindowCommand } from '../../shared/types';

export type CanvasPreviewProps = {
  windows: VirtualWindowState[];
  regions: TemplateRegion[];
  safeArea: CanvasSafeArea;
  uiOverlayActive: boolean;
  selectedRegionId: string | null;
  embeddedWindowIds: string[];
  onWindowsChange: (windows: VirtualWindowState[]) => void;
  onRegionsChange: (regions: TemplateRegion[]) => void;
  onSelectRegion: (regionId: string | null) => void;
  onWorkWindow: (hwnd: string) => void;
  onWindowCommand: (hwnd: string, command: WindowCommand) => void;
  onEmbedWindow: (windowInfo: VirtualWindowState, bounds: MoveEmbeddedWindowParams) => void;
  onDetachEmbeddedWindow: (hwnd: string) => void;
  onMoveEmbeddedWindow: (params: MoveEmbeddedWindowParams) => void;
  onSyncDwmPreviews: (previews: DwmPreviewWindow[]) => void;
  onClearDwmPreviews: () => void;
  onRelayPointerInput: (input: RelayPointerInput) => void;
  onScanWindows: () => void;
  onSaveRegions: () => void;
  onApplyWindows: (windows: VirtualWindowState[]) => void;
  onSaveRegion: (region: TemplateRegion) => void;
  fitSignal: number;
  resetViewSignal: number;
  zoomInSignal: number;
  zoomOutSignal: number;
  actualSizeSignal: number;
  cameraFocusRequest: { id: number; hwnd: string } | null;
  activityWindowHwnds: string[];
  onAcknowledgeWindowActivity: (hwnd: string) => void;
  onZoomChange: (scale: number) => void;
};

export type PanDrag = {
  type: 'pan';
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
};

export type CreateRegionDrag = {
  type: 'create-region';
  startWorldX: number;
  startWorldY: number;
};

export type WindowDrag = {
  type: 'window';
  key: string;
  startX: number;
  startY: number;
  virtualX: number;
  virtualY: number;
  moved: boolean;
};

export type RegionDrag = {
  type: 'region';
  id: string;
  startX: number;
  startY: number;
  regionX: number;
  regionY: number;
  windowPositions: Array<{ id: string; virtualX: number; virtualY: number }>;
};

export type ContextMenuState =
  | { type: 'canvas'; screenX: number; screenY: number; worldX: number; worldY: number }
  | { type: 'window'; screenX: number; screenY: number; key: string }
  | { type: 'region'; screenX: number; screenY: number; id: string };

export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
