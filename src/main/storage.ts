import { app } from 'electron';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { LayoutTemplate, SavedWorkspace } from '../shared/types';

function getTemplatesStoragePath(): string {
  return join(app.getPath('userData'), 'templates.json');
}

function getWorkspacesStoragePath(): string {
  return join(app.getPath('userData'), 'workspaces.json');
}

async function ensureJsonStorage(path: string): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true });
  if (!existsSync(path)) {
    await writeFile(path, '[]', 'utf8');
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  await ensureJsonStorage(path);
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
}

async function writeJsonFile<T>(path: string, data: T): Promise<void> {
  await ensureJsonStorage(path);
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

export async function readTemplates(): Promise<LayoutTemplate[]> {
  return readJsonFile<LayoutTemplate[]>(getTemplatesStoragePath());
}

export async function writeTemplates(templates: LayoutTemplate[]): Promise<void> {
  await writeJsonFile(getTemplatesStoragePath(), templates);
}

export async function readWorkspaces(): Promise<SavedWorkspace[]> {
  return readJsonFile<SavedWorkspace[]>(getWorkspacesStoragePath());
}

export async function writeWorkspaces(workspaces: SavedWorkspace[]): Promise<void> {
  await writeJsonFile(getWorkspacesStoragePath(), workspaces);
}
