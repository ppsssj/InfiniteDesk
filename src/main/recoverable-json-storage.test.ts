import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRecoverableJsonArray, writeRecoverableJsonArray } from './recoverable-json-storage';

const temporaryDirectories: string[] = [];

async function createStoragePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'infinitedesk-storage-'));
  temporaryDirectories.push(directory);
  return join(directory, 'items.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('recoverable JSON storage', () => {
  it('writes and reads an array', async () => {
    const path = await createStoragePath();
    await writeRecoverableJsonArray(path, [{ id: 'one' }]);

    await expect(readRecoverableJsonArray<{ id: string }>(path)).resolves.toEqual([{ id: 'one' }]);
  });

  it('recovers the last valid backup when the primary file is corrupt', async () => {
    const path = await createStoragePath();
    await writeRecoverableJsonArray(path, [{ id: 'first' }]);
    await writeRecoverableJsonArray(path, [{ id: 'second' }]);
    await writeFile(path, '{broken', 'utf8');

    await expect(readRecoverableJsonArray<{ id: string }>(path)).resolves.toEqual([{ id: 'first' }]);
    await expect(readFile(path, 'utf8')).resolves.toContain('first');
  });

  it('preserves an unreadable file and starts with an empty array when no backup exists', async () => {
    const path = await createStoragePath();
    await writeFile(path, 'not-json', 'utf8');

    await expect(readRecoverableJsonArray(path)).resolves.toEqual([]);
    const files = await readdir(dirname(path));
    expect(files.some((file) => file.startsWith('items.corrupt-') && file.endsWith('.json'))).toBe(true);
    await expect(readFile(path, 'utf8')).resolves.toBe('[]');
  });

  it('does not leave temporary files after a successful write', async () => {
    const path = await createStoragePath();
    await writeRecoverableJsonArray(path, [{ id: 'one' }]);

    const files = await readdir(dirname(path));
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false);
  });
});
