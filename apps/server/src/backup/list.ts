import { join, resolve } from 'node:path';
import { NODE_FS, directoryExists, directorySize, type BackupFs } from './files';
import { BackupManifest, isBackupDirectoryName } from './manifest';
import type { BackupEntry } from './create';

export interface BackupListDeps {
  fs?: BackupFs;
}

/** Where scheduled and API backups live inside a home. */
export function backupsDirectory(home: string): string {
  return join(resolve(home), 'backups');
}

/**
 * The backups under `<home>/backups`, newest first. Only directories named `brot-<ISO timestamp>` with a valid
 * Brot manifest count; anything else in the directory is left alone. Never returns paths or file contents.
 */
export async function listBackups(home: string, deps: BackupListDeps = {}): Promise<BackupEntry[]> {
  const fs = deps.fs ?? NODE_FS;
  const directory = backupsDirectory(home);
  if (!(await directoryExists(fs, directory))) return [];

  const entries: BackupEntry[] = [];
  for (const name of await fs.readdir(directory)) {
    if (!isBackupDirectoryName(name)) continue;
    const path = join(directory, name);
    try {
      const info = await fs.stat(path);
      if (!info.isDirectory()) continue;
      const manifest = BackupManifest.parse(JSON.parse(await fs.readFile(join(path, 'manifest.json'))));
      entries.push({
        name,
        createdAt: manifest.createdAt,
        sizeBytes: await directorySize(fs, path),
        includesSecrets: manifest.includesSecrets,
      });
    } catch {
      // A directory that is not a Brot backup is not ours to report or delete.
    }
  }

  return entries.sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
    return left.name < right.name ? 1 : -1;
  });
}

/**
 * Deletes all but the newest `keep` backups under `<home>/backups`. Only `brot-<ISO>` directories that list as
 * Brot backups are considered. Returns the names it removed.
 */
export async function pruneBackups(home: string, keep: number, deps: BackupListDeps = {}): Promise<string[]> {
  const fs = deps.fs ?? NODE_FS;
  const keepCount = Number.isFinite(keep) ? Math.min(Math.max(1, Math.trunc(keep)), 30) : 5;
  const entries = await listBackups(home, deps);
  const removed: string[] = [];
  for (const entry of entries.slice(keepCount)) {
    await fs.rm(join(backupsDirectory(home), entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}
