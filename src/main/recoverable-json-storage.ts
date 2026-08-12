import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

type ValidJsonArray<T> = {
  data: T[];
  raw: string;
};

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readValidJsonArray<T>(path: string): Promise<ValidJsonArray<T> | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? { data: data as T[], raw } : null;
  } catch {
    return null;
  }
}

async function atomicWriteText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function getCorruptStoragePath(path: string): string {
  const extension = extname(path);
  const name = basename(path, extension);
  return join(dirname(path), `${name}.corrupt-${Date.now()}-${randomUUID()}${extension}`);
}

async function preserveCorruptStorage(path: string): Promise<string | null> {
  const corruptPath = getCorruptStoragePath(path);
  try {
    await rename(path, corruptPath);
    return corruptPath;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

export async function readRecoverableJsonArray<T>(path: string): Promise<T[]> {
  await mkdir(dirname(path), { recursive: true });

  const primary = await readValidJsonArray<T>(path);
  if (primary) {
    return primary.data;
  }

  const backupPath = `${path}.bak`;
  const backup = await readValidJsonArray<T>(backupPath);
  if (backup) {
    await preserveCorruptStorage(path);
    await atomicWriteText(path, backup.raw);
    console.warn(`[storage] Recovered ${basename(path)} from its backup.`);
    return backup.data;
  }

  const corruptPath = await preserveCorruptStorage(path);
  await atomicWriteText(path, '[]');
  if (corruptPath) {
    console.error(`[storage] Preserved unreadable storage at ${corruptPath}.`);
  }
  return [];
}

export async function writeRecoverableJsonArray<T>(path: string, data: readonly T[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const current = await readValidJsonArray<T>(path);
  if (current) {
    await atomicWriteText(`${path}.bak`, current.raw);
  } else {
    await preserveCorruptStorage(path);
  }

  await atomicWriteText(path, JSON.stringify(data, null, 2));
}
