export type DetectedWindow = {
  hwnd: string;
  title: string;
  processName: string;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  isMinimized: boolean;
  isRestorable: boolean;
  isForeground?: boolean;
  isInternal?: boolean;
  isIgnored?: boolean;
  statusReason?: string;
};

export type LayoutTemplate = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  windows: DetectedWindow[];
};

export type CreateTemplateInput = {
  name: string;
  windows: DetectedWindow[];
};

export type WorkspaceRegion = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  windowIds: string[];
  color?: string;
  createdAt: string;
};

export type SavedWorkspace = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  windows: DetectedWindow[];
  regions: WorkspaceRegion[];
};

export type CreateWorkspaceInput = {
  name: string;
  windows: DetectedWindow[];
  regions: WorkspaceRegion[];
};

export type ApplyLayoutInput = {
  windows: DetectedWindow[];
};

export type DockApp = {
  id: string;
  name: string;
  executablePath: string;
  args?: string[];
  icon?: string;
  iconDataUrl?: string;
  processName?: string;
  isPinned: boolean;
};

export type LaunchResult = {
  success: boolean;
  error?: string;
};

export type QuickLaunch = {
  id: string;
  name: string;
  app: DockApp;
  x: number;
  y: number;
  sourceHwnd?: string;
  sourceTitle?: string;
  processName?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateQuickLaunchInput = {
  name: string;
  app: DockApp;
  x: number;
  y: number;
  sourceHwnd?: string;
  sourceTitle?: string;
  processName?: string;
};

export type FocusWindowResult = {
  success: boolean;
  hwnd: string;
  error?: string;
};

export type WindowCommand = 'focus' | 'minimize' | 'maximize' | 'restore' | 'close';

export type WindowCommandResult = {
  success: boolean;
  hwnd: string;
  command: WindowCommand;
  error?: string;
};

export type RelayPointerInput = {
  hwnd: string;
  normalizedX: number;
  normalizedY: number;
  action: 'down' | 'move' | 'up' | 'cancel' | 'wheel';
  button?: 'left' | 'right' | 'middle';
  buttons?: number;
  clickCount?: number;
  wheelDelta?: number;
};

export type RelayPointerResult = {
  success: boolean;
  hwnd: string;
  error?: string;
};

export type OverlayModeResult = {
  success: boolean;
  enabled: boolean;
  error?: string;
};

export type EmbedWindowParams = {
  hwnd: string;
  hostHwnd?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MoveEmbeddedWindowParams = {
  hwnd: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type EmbedResult = {
  success: boolean;
  hwnd: string;
  error?: string;
  originalParentHwnd?: string;
  originalStyle?: string;
  originalExStyle?: string;
  originalX?: number;
  originalY?: number;
  originalWidth?: number;
  originalHeight?: number;
};

export type DwmPreviewWindow = {
  id: string;
  hwnd: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  visible: boolean;
  opacity?: number;
};

export type DwmPreviewResult = {
  success: boolean;
  error?: string;
};

export type RestoreResult = {
  restored: number;
  skipped: number;
  errors: string[];
};
