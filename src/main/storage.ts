import { app } from 'electron';
import { join } from 'node:path';
import type { DockApp, LayoutTemplate, SavedWorkspace } from '../shared/types';
import { readRecoverableJsonArray, writeRecoverableJsonArray } from './recoverable-json-storage';

function getTemplatesStoragePath(): string {
  return join(app.getPath('userData'), 'templates.json');
}

function getWorkspacesStoragePath(): string {
  return join(app.getPath('userData'), 'workspaces.json');
}

function getPinnedDockAppsStoragePath(): string {
  return join(app.getPath('userData'), 'pinned-dock-apps.json');
}

export async function readTemplates(): Promise<LayoutTemplate[]> {
  return readRecoverableJsonArray<LayoutTemplate>(getTemplatesStoragePath());
}

export async function writeTemplates(templates: LayoutTemplate[]): Promise<void> {
  await writeRecoverableJsonArray(getTemplatesStoragePath(), templates);
}

export async function readWorkspaces(): Promise<SavedWorkspace[]> {
  return readRecoverableJsonArray<SavedWorkspace>(getWorkspacesStoragePath());
}

export async function writeWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  await writeRecoverableJsonArray(getWorkspacesStoragePath(), workspaces);
}

export async function readPinnedDockApps(): Promise<DockApp[]> {
  return readRecoverableJsonArray<DockApp>(getPinnedDockAppsStoragePath());
}

export async function writePinnedDockApps(apps: DockApp[]): Promise<void> {
  await writeRecoverableJsonArray(getPinnedDockAppsStoragePath(), apps);
}
