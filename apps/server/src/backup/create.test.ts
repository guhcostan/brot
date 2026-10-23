import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, createRepos, migrate } from '@brot/db';
import { createBackup } from './create';
import { BackupManifest } from './manifest';

const dirs: string[] = [];
const FIXED = new Date('2026-10-23T02:00:00.000Z');

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix = 'brot-backup-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function makeHome(): Promise<string> {
  const home = await tempDir('brot-backup-home-');
  const db = await createDb(`file:${join(home, 'brot.db')}`);
  await migrate(db.db);
  const repos = createRepos(db.db);
  const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
  await repos.threads.create(bot.id, { title: 'Chat' });
  db.client.close();
  await mkdir(join(home, 'attachments'), { recursive: true });
  await writeFile(join(home, 'attachments', 'note.txt'), 'attachment bytes');
  await writeFile(join(home, 'providers.json'), '{"providers":[]}\n');
  await writeFile(join(home, 'vault.json'), '{"sealed":true}\n');
  await writeFile(join(home, 'vault.key'), 'k'.repeat(32));
  return home;
}

async function countsOf(database: string): Promise<{ bots: number; threads: number }> {
  const handle = await createDb(`file:${database}`);
  try {
    const bots = await handle.client.execute('SELECT COUNT(*) AS count FROM bots');
    const threads = await handle.client.execute('SELECT COUNT(*) AS count FROM threads');
    return { bots: Number(bots.rows[0]?.count), threads: Number(threads.rows[0]?.count) };
  } finally {
    handle.client.close();
  }
}

function fixedNow(): Date {
  return FIXED;
}

describe('createBackup', () => {
  it('writes a consistent snapshot, the extra files, the vault and a manifest', async () => {
    const home = await makeHome();
    const created = await createBackup({ home }, { now: fixedNow });

    expect(created.name).toBe(`brot-${FIXED.toISOString()}`);
    expect(created.createdAt).toBe(FIXED.toISOString());
    expect(created.includesSecrets).toBe(true);
    expect(created.files).toEqual(['brot.db', 'attachments', 'providers.json', 'vault.json', 'vault.key']);
    expect(created.sizeBytes).toBeGreaterThan(0);
    expect((await stat(created.path)).mode & 0o777).toBe(0o700);
    expect((await stat(join(created.path, 'vault.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(created.path, 'vault.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(created.path, 'attachments', 'note.txt'), 'utf8')).toBe('attachment bytes');

    const manifest = BackupManifest.parse(JSON.parse(await readFile(join(created.path, 'manifest.json'), 'utf8')));
    expect(manifest).toMatchObject({
      format: 'brot-backup',
      version: 1,
      createdAt: FIXED.toISOString(),
      includesSecrets: true,
    });
    expect(manifest.files).toEqual(created.files);
    expect(await countsOf(join(created.path, 'brot.db'))).toEqual({ bots: 1, threads: 1 });
  });

  it('excludes the vault and reports it when includeSecrets is false', async () => {
    const home = await makeHome();
    const out = join(home, 'plain');
    const created = await createBackup({ home, out, includeSecrets: false }, { now: fixedNow });
    expect(created.includesSecrets).toBe(false);
    await expect(stat(join(out, 'vault.json'))).rejects.toThrow();
    await expect(stat(join(out, 'vault.key'))).rejects.toThrow();
  });

  it('snapshots a consistent database even while the live database keeps changing', async () => {
    const home = await makeHome();
    const out = join(home, 'snapshot');
    await createBackup({ home, out }, { now: fixedNow });

    const live = await createDb(`file:${join(home, 'brot.db')}`);
    try {
      await createRepos(live.db).bots.create({ name: 'Grace', job: 'Ops' });
    } finally {
      live.client.close();
    }
    expect(await countsOf(join(out, 'brot.db'))).toEqual({ bots: 1, threads: 1 });
  });

  it('backups only the database when nothing else exists', async () => {
    const home = await tempDir('brot-backup-bare-');
    const db = await createDb(`file:${join(home, 'brot.db')}`);
    await migrate(db.db);
    db.client.close();

    const created = await createBackup({ home }, { now: fixedNow });
    expect(created.files).toEqual(['brot.db']);
    expect(created.includesSecrets).toBe(false);
  });

  it('refuses a non-empty destination without force, and replaces the snapshot with it', async () => {
    const home = await makeHome();
    const out = await tempDir('brot-backup-out-');
    await writeFile(join(out, 'junk.txt'), 'keep me');
    await writeFile(join(out, 'brot.db'), 'not a database');
    await writeFile(join(out, 'brot.db-wal'), 'stale');

    await expect(createBackup({ home, out }, { now: fixedNow })).rejects.toThrow(/not empty; pass --force/);
    expect(await readFile(join(out, 'brot.db'), 'utf8')).toBe('not a database');

    const created = await createBackup({ home, out, force: true }, { now: fixedNow });
    expect(created.name.startsWith('brot-backup-out-')).toBe(true);
    expect(await readFile(join(out, 'junk.txt'), 'utf8')).toBe('keep me');
    await expect(stat(join(out, 'brot.db-wal'))).rejects.toThrow();
    expect(await countsOf(join(out, 'brot.db'))).toEqual({ bots: 1, threads: 1 });
  });

  it('refuses a home without a database', async () => {
    const home = await tempDir('brot-backup-empty-');
    await expect(createBackup({ home })).rejects.toThrow(/no database at/);
  });
});
