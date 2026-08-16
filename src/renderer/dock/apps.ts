import type { DockApp } from '../../shared/types';

export const defaultDockApps: DockApp[] = [
  {
    id: 'chrome',
    name: 'Chrome',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    processName: 'chrome',
    icon: 'CH',
    isPinned: true
  },
  {
    id: 'terminal',
    name: 'Terminal',
    executablePath: 'wt',
    processName: 'WindowsTerminal',
    icon: 'WT',
    isPinned: true
  },
  {
    id: 'explorer',
    name: 'File Explorer',
    executablePath: 'explorer.exe',
    processName: 'explorer',
    icon: 'FE',
    isPinned: true
  },
  {
    id: 'settings',
    name: 'Settings',
    executablePath: 'ms-settings:',
    processName: 'SystemSettings',
    icon: 'SE',
    isPinned: true
  }
];
