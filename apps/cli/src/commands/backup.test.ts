import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, createRepos, migrate } from '@brot/db';
import { capture } from '../testing';
import { BackupManifest, runBackup } from './backup';

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

async function manifestAt(dir: string): Promise<BackupManifest> {
  return BackupManifest.parse(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
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

describe('brot backup', () => {
  it('writes a database snapshot, attachments, providers, vault and manifest', async () => {
    const home = await makeHome();
    const stdout = capture();
    expect(await runBackup({}, { home, stdout, now: () => FIXED })).toBe(0);

    const out = join(home, 'backups', `brot-${FIXED.toISOString()}`);
    expect((await stat(out)).mode & 0o777).toBe(0o700);
    for (const relative of [
      'brot.db',
      'manifest.json',
      'attachments/note.txt',
      'providers.json',
      'vault.json',
      'vault.key',
    ]) {
      await expect(stat(join(out, relative))).resolves.toBeDefined();
    }
    expect((await stat(join(out, 'vault.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(out, 'vault.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(out, 'attachments', 'note.txt'), 'utf8')).toBe('attachment bytes');

    const manifest = await manifestAt(out);
    expect(manifest).toMatchObject({
      format: 'brot-backup',
      version: 1,
      createdAt: FIXED.toISOString(),
      includesSecrets: true,
    });
    expect(manifest.files).toEqual(['brot.db', 'attachments', 'providers.json', 'vault.json', 'vault.key']);
    expect(stdout.text()).toContain(`Backup written to ${out}`);
    expect(stdout.text()).toContain('secrets: included');
    expect(stdout.text()).toContain('Keep this backup private');

    expect(await countsOf(join(out, 'brot.db'))).toEqual({ bots: 1, threads: 1 });
  });

  it('snapshots a consistent database even while the live database keeps changing', async () => {
    const home = await makeHome();
    expect(await runBackup({ out: join(home, 'snapshot') }, { home, stdout: capture(), now: () => FIXED })).toBe(0);

    const live = await createDb(`file:${join(home, 'brot.db')}`);
    try {
      await createRepos(live.db).bots.create({ name: 'Grace', job: 'Ops' });
    } finally {
      live.client.close();
    }
    expect(await countsOf(join(home, 'snapshot', 'brot.db'))).toEqual({ bots: 1, threads: 1 });
  });

  it('leaves the vault out with --no-secrets', async () => {
    const home = await makeHome();
    const stdout = capture();
    const out = join(home, 'plain');
    expect(await runBackup({ out, noSecrets: true }, { home, stdout, now: () => FIXED })).toBe(0);
    await expect(stat(join(out, 'vault.json'))).rejects.toThrow();
    await expect(stat(join(out, 'vault.key'))).rejects.toThrow();
    expect((await manifestAt(out)).includesSecrets).toBe(false);
    expect((await manifestAt(out)).files).toEqual(['brot.db', 'attachments', 'providers.json']);
    expect(stdout.text()).toContain('secrets: not included');
  });

  it('backs up only the database when nothing else exists', async () => {
    const home = await tempDir('brot-backup-bare-');
    const db = await createDb(`file:${join(home, 'brot.db')}`);
    await migrate(db.db);
    db.client.close();

    expect(await runBackup({}, { home, stdout: capture(), now: () => FIXED })).toBe(0);
    const out = join(home, 'backups', `brot-${FIXED.toISOString()}`);
    expect((await manifestAt(out)).files).toEqual(['brot.db']);
    expect((await manifestAt(out)).includesSecrets).toBe(false);
  });

  it('refuses a non-empty destination without --force, and overwrites with it', async () => {
    const home = await makeHome();
    const out = await tempDir('brot-backup-out-');
    await writeFile(join(out, 'junk.txt'), 'keep me');
    await writeFile(join(out, 'brot.db'), 'not a database');
    await writeFile(join(out, 'brot.db-wal'), 'stale');

    await expect(runBackup({ out }, { home, stdout: capture(), now: () => FIXED })).rejects.toThrow(
      /not empty; pass --force/,
    );
    expect(await readFile(join(out, 'brot.db'), 'utf8')).toBe('not a database');

    expect(await runBackup({ out, force: true }, { home, stdout: capture(), now: () => FIXED })).toBe(0);
    expect(await readFile(join(out, 'junk.txt'), 'utf8')).toBe('keep me');
    await expect(stat(join(out, 'brot.db-wal'))).rejects.toThrow();
    expect(await countsOf(join(out, 'brot.db'))).toEqual({ bots: 1, threads: 1 });
    expect((await manifestAt(out)).createdAt).toBe(FIXED.toISOString());
  });

  it('refuses a home without a database', async () => {
    const home = await tempDir('brot-backup-empty-');
    await expect(runBackup({}, { home, stdout: capture() })).rejects.toThrow(/no database at/);
  });
});
