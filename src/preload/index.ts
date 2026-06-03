import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApplyLayoutInput,
  CreateTemplateInput,
  DetectedWindow,
  DockApp,
  FocusWindowResult,
  LaunchResult,
  LayoutTemplate,
  MoveWindowResult,
  RestoreResult,
  WindowCommand,
  WindowCommandResult
} from '../shared/types';

const api = {
  scanWindows: (): Promise<DetectedWindow[]> => ipcRenderer.invoke('windows:scan'),
  listTemplates: (): Promise<LayoutTemplate[]> => ipcRenderer.invoke('templates:list'),
  createTemplate: (input: CreateTemplateInput): Promise<LayoutTemplate> => ipcRenderer.invoke('templates:create', input),
  deleteTemplate: (id: string): Promise<void> => ipcRenderer.invoke('templates:delete', id),
  restoreTemplate: (id: string): Promise<RestoreResult> => ipcRenderer.invoke('templates:restore', id),
  applyLayout: (input: ApplyLayoutInput): Promise<RestoreResult> => ipcRenderer.invoke('layout:apply', input),
  launchApp: (app: DockApp): Promise<LaunchResult> => ipcRenderer.invoke('dock:launch-app', app),
  moveWindow: (windowInfo: DetectedWindow): Promise<MoveWindowResult> => ipcRenderer.invoke('window:move', windowInfo),
  focusWindow: (hwnd: string): Promise<FocusWindowResult> => ipcRenderer.invoke('window:focus', hwnd),
  workInWindow: (hwnd: string): Promise<FocusWindowResult> => ipcRenderer.invoke('window:work', hwnd),
  controlWindow: (hwnd: string, command: WindowCommand): Promise<WindowCommandResult> =>
    ipcRenderer.invoke('window:command', hwnd, command)
};

contextBridge.exposeInMainWorld('infiniteDesk', api);

declare global {
  interface Window {
    infiniteDesk: typeof api;
  }
}
