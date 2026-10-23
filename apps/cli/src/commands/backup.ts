import { join, resolve } from 'node:path';
import { createDb } from '@brot/db';
import { IsoDateTime } from '@brot/protocol';
import { z } from 'zod';
import type { Writer } from '../io';
import { NODE_FS, directoryExists, exists, fileExists, type BackupFs } from './backup-fs';

/** What a manifest must say to be a Brot backup this build can restore. */
export const BACKUP_FORMAT = 'brot-backup';
export const BACKUP_VERSION = 1;

export const BackupManifest = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  createdAt: IsoDateTime,
  includesSecrets: z.boolean(),
  /** Paths relative to the backup directory. `brot.db` is always present. */
  files: z.array(z.string().min(1)),
});
export type BackupManifest = z.infer<typeof BackupManifest>;

export interface BackupOptions {
  /** Default: `<home>/backups/brot-<createdAt>`. */
  out?: string;
  noSecrets?: boolean;
  /** Write into a non-empty destination. */
  force?: boolean;
}

export interface BackupDeps {
  home: string;
  stdout: Writer;
  fs?: BackupFs;
  now?: () => Date;
}

/**
 * Writes a consistent snapshot of one Brot home: `brot.db` (through SQLite `VACUUM INTO`, never by copying WAL/SHM
 * files), `attachments/` and `providers.json` when present, and the vault (`vault.json` + `vault.key`, mode 0600)
 * unless `--no-secrets`. A `manifest.json` describes what was written. The server may keep running: VACUUM INTO
 * reads a consistent view, so no file is copied while being written. Returns the process exit code.
 */
export async function runBackup(options: BackupOptions, deps: BackupDeps): Promise<number> {
  const fs = deps.fs ?? NODE_FS;
  const home = resolve(deps.home);
  const database = join(home, 'brot.db');
  if (!(await fileExists(fs, database))) {
    throw new Error(`no database at ${database}; start Brot once so it creates one, then back up again`);
  }

  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  const out = options.out === undefined ? join(home, 'backups', `brot-${createdAt}`) : resolve(options.out);
  await prepareDestination(fs, out, options.force === true);

  const snapshot = join(out, 'brot.db');
  const live = await createDb(`file:${database}`);
  try {
    await live.client.execute(`VACUUM INTO '${sqlString(snapshot)}'`);
  } finally {
    live.client.close();
  }

  const files = ['brot.db'];
  const attachments = join(home, 'attachments');
  if (await directoryExists(fs, attachments)) {
    await fs.cp(attachments, join(out, 'attachments'), { recursive: true });
    files.push('attachments');
  }

  const providers = join(home, 'providers.json');
  if (await fileExists(fs, providers)) {
    await fs.copyFile(providers, join(out, 'providers.json'));
    files.push('providers.json');
  }

  const hiddenSecrets = options.noSecrets === true ? [] : await copyVault(fs, home, out);
  files.push(...hiddenSecrets);

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    includesSecrets: hiddenSecrets.length > 0,
    files,
  };
  await fs.writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const size = await directorySize(fs, out);
  deps.stdout.write(`Backup written to ${out}\n`);
  deps.stdout.write(`files: ${files.join(', ')}\n`);
  deps.stdout.write(`size: ${size} bytes\n`);
  if (manifest.includesSecrets) {
    deps.stdout.write('secrets: included (vault.json, vault.key). Keep this backup private.\n');
  } else {
    deps.stdout.write('secrets: not included\n');
  }
  return 0;
}

/** Creates the destination, or clears the snapshot it may already contain when `--force` allows writing into it. */
async function prepareDestination(fs: BackupFs, out: string, force: boolean): Promise<void> {
  if (!(await exists(fs, out))) {
    await fs.mkdir(out, { recursive: true, mode: 0o700 });
    return;
  }
  if (!(await directoryExists(fs, out))) {
    throw new Error(`backup destination ${out} is not a directory`);
  }
  const entries = await fs.readdir(out);
  if (entries.length === 0) return;
  if (!force) {
    throw new Error(`backup destination ${out} is not empty; pass --force to write into it`);
  }
  // VACUUM INTO refuses an existing output file, so the previous snapshot (and its stale WAL) goes first.
  for (const name of ['brot.db', 'brot.db-wal', 'brot.db-shm']) {
    await fs.rm(join(out, name), { force: true });
  }
}

async function copyVault(fs: BackupFs, home: string, out: string): Promise<string[]> {
  const copied: string[] = [];
  for (const name of ['vault.json', 'vault.key']) {
    const source = join(home, name);
    if (!(await fileExists(fs, source))) continue;
    const target = join(out, name);
    await fs.copyFile(source, target);
    await fs.chmod(target, 0o600);
    copied.push(name);
  }
  return copied;
}

/** Sum of the sizes of every file under `dir`, as a rough estimate shown in the summary. */
async function directorySize(fs: BackupFs, dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir)) {
    const path = join(dir, entry);
    const info = await fs.stat(path);
    total += info.isDirectory() ? await directorySize(fs, path) : info.size;
  }
  return total;
}

/** Quotes a filesystem path for a SQLite string literal. VACUUM INTO takes a literal filename. */
export function sqlString(value: string): string {
  return value.replaceAll("'", "''");
}
