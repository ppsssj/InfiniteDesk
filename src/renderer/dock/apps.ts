import type { DockApp } from '../../shared/types';

export const defaultDockApps: DockApp[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    executablePath: 'code',
    processName: 'Code',
    icon: 'VS',
    isPinned: true
  },
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
    name: 'Explorer',
    executablePath: 'explorer.exe',
    processName: 'explorer',
    icon: 'EX',
    isPinned: true
  }
];
