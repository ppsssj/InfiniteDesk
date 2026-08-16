import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApplyLayoutInput,
  CreateTemplateInput,
  CreateWorkspaceInput,
  DetectedWindow,
  DockApp,
  DwmPreviewResult,
  DwmPreviewWindow,
  EmbedResult,
  EmbedWindowParams,
  FocusWindowResult,
  LaunchResult,
  LayoutTemplate,
  MoveEmbeddedWindowParams,
  OverlayModeResult,
  RelayPointerInput,
  RelayPointerResult,
  RestoreResult,
  SavedWorkspace,
  WindowCommand,
  WindowCommandResult
} from '../shared/types';

const api = {
  scanWindows: (): Promise<DetectedWindow[]> => ipcRenderer.invoke('windows:scan'),
  listTemplates: (): Promise<LayoutTemplate[]> => ipcRenderer.invoke('templates:list'),
  createTemplate: (input: CreateTemplateInput): Promise<LayoutTemplate> => ipcRenderer.invoke('templates:create', input),
  deleteTemplate: (id: string): Promise<void> => ipcRenderer.invoke('templates:delete', id),
  restoreTemplate: (id: string): Promise<RestoreResult> => ipcRenderer.invoke('templates:restore', id),
  listWorkspaces: (): Promise<SavedWorkspace[]> => ipcRenderer.invoke('workspaces:list'),
  createWorkspace: (input: CreateWorkspaceInput): Promise<SavedWorkspace> => ipcRenderer.invoke('workspaces:create', input),
  deleteWorkspace: (id: string): Promise<void> => ipcRenderer.invoke('workspaces:delete', id),
  restoreWorkspace: (id: string): Promise<RestoreResult> => ipcRenderer.invoke('workspaces:restore', id),
  applyLayout: (input: ApplyLayoutInput): Promise<RestoreResult> => ipcRenderer.invoke('layout:apply', input),
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  listDockApps: (): Promise<DockApp[]> => ipcRenderer.invoke('dock:list-apps'),
  listPinnedDockApps: (): Promise<DockApp[]> => ipcRenderer.invoke('dock:list-pinned-apps'),
  pinDockApp: (app: DockApp): Promise<DockApp[]> => ipcRenderer.invoke('dock:pin-app', app),
  unpinDockApp: (appId: string): Promise<DockApp[]> => ipcRenderer.invoke('dock:unpin-app', appId),
  launchApp: (appId: string): Promise<LaunchResult> => ipcRenderer.invoke('dock:launch-app', appId),
  focusWindow: (hwnd: string): Promise<FocusWindowResult> => ipcRenderer.invoke('window:focus', hwnd),
  workInWindow: (hwnd: string): Promise<FocusWindowResult> => ipcRenderer.invoke('window:work', hwnd),
  setOverlayMode: (enabled: boolean): Promise<OverlayModeResult> => ipcRenderer.invoke('app:set-overlay-mode', enabled),
  embedWindowToHost: (params: EmbedWindowParams): Promise<EmbedResult> => ipcRenderer.invoke('window:embed', params),
  detachEmbeddedWindow: (hwnd: string): Promise<EmbedResult> => ipcRenderer.invoke('window:detach-embedded', hwnd),
  moveEmbeddedWindow: (params: MoveEmbeddedWindowParams): Promise<EmbedResult> => ipcRenderer.invoke('window:move-embedded', params),
  syncDwmPreviews: (previews: DwmPreviewWindow[]): Promise<DwmPreviewResult> => ipcRenderer.invoke('dwm:sync-previews', previews),
  clearDwmPreviews: (): Promise<DwmPreviewResult> => ipcRenderer.invoke('dwm:clear-previews'),
  controlWindow: (hwnd: string, command: WindowCommand): Promise<WindowCommandResult> =>
    ipcRenderer.invoke('window:command', hwnd, command),
  relayPointerInput: (input: RelayPointerInput): Promise<RelayPointerResult> => ipcRenderer.invoke('window:relay-pointer', input),
  onWindowInteractionComplete: (callback: (hwnd: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, hwnd: string): void => callback(hwnd);
    ipcRenderer.on('windows:interaction-complete', listener);
    return () => ipcRenderer.removeListener('windows:interaction-complete', listener);
  },
  onWindowClosed: (callback: (hwnd: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, hwnd: string): void => callback(hwnd);
    ipcRenderer.on('windows:closed', listener);
    return () => ipcRenderer.removeListener('windows:closed', listener);
  }
};

contextBridge.exposeInMainWorld('infiniteDesk', api);

declare global {
  interface Window {
    infiniteDesk: typeof api;
  }
}
