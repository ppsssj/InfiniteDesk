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

export type ApplyLayoutInput = {
  windows: DetectedWindow[];
};

export type DockApp = {
  id: string;
  name: string;
  executablePath: string;
  args?: string[];
  icon?: string;
  processName?: string;
  isPinned: boolean;
};

export type LaunchResult = {
  success: boolean;
  error?: string;
};

export type MoveWindowResult = {
  success: boolean;
  hwnd: string;
  error?: string;
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

export type RestoreResult = {
  restored: number;
  skipped: number;
  errors: string[];
};
