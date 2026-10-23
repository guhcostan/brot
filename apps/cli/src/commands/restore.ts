import { join, resolve } from 'node:path';
import { createDb, migrate } from '@brot/db';
import type { Writer } from '../io';
import { BACKUP_FORMAT, BackupManifest } from './backup';
import { NODE_FS, directoryExists, exists, fileExists, type BackupFs } from './backup-fs';

export interface RestoreOptions {
  from: string;
  /** Overwrite a non-empty home (Brot must be stopped). */
  force?: boolean;
}

export interface RestoreDeps {
  home: string;
  stdout: Writer;
  fs?: BackupFs;
}

/**
 * Restores a backup written by `brot backup` into a home. Validates the manifest and every listed file first, then
 * copies the snapshot, attachments, providers and vault into the home, removing stale `-wal`/`-shm` files, and
 * opens + migrates the restored database to prove it is usable, printing the bot and thread counts. The source
 * directory is only read. The Brot server must be stopped before restoring; this command cannot enforce that.
 */
export async function runRestore(options: RestoreOptions, deps: RestoreDeps): Promise<number> {
  const fs = deps.fs ?? NODE_FS;
  const from = resolve(options.from);
  const home = resolve(deps.home);
  const manifest = await readManifest(fs, from);
  await requireBackupFiles(fs, from, manifest);
  await prepareHome(fs, home, options.force === true);

  for (const name of ['brot.db-wal', 'brot.db-shm']) {
    await fs.rm(join(home, name), { force: true });
  }
  await fs.copyFile(join(from, 'brot.db'), join(home, 'brot.db'));

  for (const relative of manifest.files) {
    if (relative === 'brot.db') continue;
    const source = join(from, relative);
    if (relative === 'attachments') {
      if (await directoryExists(fs, source)) await fs.cp(source, join(home, 'attachments'), { recursive: true });
      continue;
    }
    if (!(await fileExists(fs, source))) continue;
    const target = join(home, relative);
    await fs.copyFile(source, target);
    if (relative === 'vault.json' || relative === 'vault.key') await fs.chmod(target, 0o600);
  }

  const counts = await verifyDatabase(join(home, 'brot.db'));
  // The verification connection ran in WAL mode; after its checkpoint these files carry nothing.
  for (const name of ['brot.db-wal', 'brot.db-shm']) {
    await fs.rm(join(home, name), { force: true });
  }
  deps.stdout.write(`Restored ${home} from ${from}\n`);
  deps.stdout.write(`bots: ${counts.bots}\n`);
  deps.stdout.write(`threads: ${counts.threads}\n`);
  return 0;
}

async function readManifest(fs: BackupFs, from: string): Promise<BackupManifest> {
  const path = join(from, 'manifest.json');
  if (!(await fileExists(fs, path))) throw new Error(`no backup manifest at ${path}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(path));
  } catch {
    throw new Error(`the backup manifest at ${path} is not valid JSON`);
  }
  const parsed = BackupManifest.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.length === 0 ? 'manifest' : issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`${from} is not a Brot backup (${BACKUP_FORMAT} v1): ${detail}`);
  }
  return parsed.data;
}

/** Every file the manifest names must exist, and a backup with secrets must carry both vault files. */
async function requireBackupFiles(fs: BackupFs, from: string, manifest: BackupManifest): Promise<void> {
  if (!(await fileExists(fs, join(from, 'brot.db')))) {
    throw new Error('the backup is incomplete: missing brot.db');
  }
  for (const relative of manifest.files) {
    if (!(await exists(fs, join(from, relative)))) {
      throw new Error(`the backup is incomplete: missing ${relative}`);
    }
  }
  if (manifest.includesSecrets) {
    for (const name of ['vault.json', 'vault.key']) {
      if (!(await fileExists(fs, join(from, name)))) {
        throw new Error(`the backup is incomplete: missing ${name}`);
      }
    }
  }
}

/** Refuses a non-empty home without `--force`, then creates/uses it. */
async function prepareHome(fs: BackupFs, home: string, force: boolean): Promise<void> {
  if (await exists(fs, home)) {
    if (!(await directoryExists(fs, home))) throw new Error(`restore target ${home} is not a directory`);
    const entries = await fs.readdir(home);
    if (entries.length > 0 && !force) {
      throw new Error(
        `restore target ${home} is not empty; stop Brot and pass --force to overwrite its database and files`,
      );
    }
    return;
  }
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
}

/** Opens and migrates the restored database, returning the counts that prove it is a Brot database. */
async function verifyDatabase(path: string): Promise<{ bots: number; threads: number }> {
  const handle = await createDb(`file:${path}`);
  try {
    await migrate(handle.db);
    const bots = await handle.client.execute('SELECT COUNT(*) AS count FROM bots');
    const threads = await handle.client.execute('SELECT COUNT(*) AS count FROM threads');
    await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    return { bots: countOf(bots.rows[0]?.count), threads: countOf(threads.rows[0]?.count) };
  } catch (error) {
    throw new Error(
      `the restored database at ${path} is not a usable Brot database: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    handle.client.close();
  }
}

function countOf(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}
