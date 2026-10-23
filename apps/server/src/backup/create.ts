import { basename, join, resolve } from 'node:path';
import { createDb } from '@brot/db';
import {
  NODE_FS,
  directoryExists,
  directorySize,
  exists,
  fileExists,
  type BackupFs,
} from './files';
import { BACKUP_FORMAT, BACKUP_VERSION, type BackupManifest } from './manifest';

/** The list/API view of one backup: what it is, how big, and whether it carries secrets. Never its path. */
export interface BackupEntry {
  /** Directory name under `<home>/backups`, `brot-<ISO timestamp>`. */
  name: string;
  createdAt: string;
  sizeBytes: number;
  includesSecrets: boolean;
}

/** What creating a backup produced: the entry plus the directory it was written to and the files it holds. */
export interface CreatedBackup extends BackupEntry {
  path: string;
  files: string[];
}

export interface CreateBackupOptions {
  home: string;
  /** Destination directory. Defaults to `<home>/backups/brot-<createdAt>`. */
  out?: string;
  /** Include `vault.json` + `vault.key`. Defaults to true: backups are local, same-machine snapshots. */
  includeSecrets?: boolean;
  /** Write into a non-empty destination, replacing an earlier snapshot there. */
  force?: boolean;
}

export interface CreateBackupDeps {
  fs?: BackupFs;
  now?: () => Date;
}

/**
 * Writes a consistent snapshot of one Brot home: `brot.db` (through SQLite `VACUUM INTO`, never by copying the
 * WAL/SHM files), `attachments/` and `providers.json` when present, and the vault (`vault.json` + `vault.key`,
 * mode 0600) unless secrets are excluded. A `manifest.json` describes what was written. The server may keep
 * running: VACUUM INTO reads a consistent view, so no file is copied while being written.
 */
export async function createBackup(options: CreateBackupOptions, deps: CreateBackupDeps = {}): Promise<CreatedBackup> {
  const fs = deps.fs ?? NODE_FS;
  const home = resolve(options.home);
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

  const vaultFiles = options.includeSecrets === false ? [] : await copyVault(fs, home, out);
  files.push(...vaultFiles);

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt,
    includesSecrets: vaultFiles.length > 0,
    files,
  };
  await fs.writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  return {
    name: basename(out),
    path: out,
    createdAt,
    includesSecrets: manifest.includesSecrets,
    files,
    sizeBytes: await directorySize(fs, out),
  };
}

/** Creates the destination, or clears the snapshot it may already contain when `force` allows writing into it. */
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

/** Quotes a filesystem path for a SQLite string literal. VACUUM INTO takes a literal filename. */
export function sqlString(value: string): string {
  return value.replaceAll("'", "''");
}
