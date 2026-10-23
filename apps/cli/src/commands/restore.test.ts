import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, createRepos, migrate } from '@brot/db';
import { capture } from '../testing';
import { runBackup } from './backup';
import { runRestore } from './restore';

const dirs: string[] = [];
const FIXED = new Date('2026-10-23T02:00:00.000Z');

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix = 'brot-restore-test-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function makeSource(): Promise<{ source: string; home: string }> {
  const home = await tempDir('brot-restore-home-');
  const db = await createDb(`file:${join(home, 'brot.db')}`);
  await migrate(db.db);
  const repos = createRepos(db.db);
  const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
  await repos.threads.create(bot.id, { title: 'Chat' });
  await repos.threads.create(bot.id, { title: 'Second' });
  db.client.close();
  await mkdir(join(home, 'attachments'), { recursive: true });
  await writeFile(join(home, 'attachments', 'note.txt'), 'attachment bytes');
  await writeFile(join(home, 'providers.json'), '{"providers":[]}\n');
  await writeFile(join(home, 'vault.json'), '{"sealed":true}\n');
  await writeFile(join(home, 'vault.key'), 'k'.repeat(32));

  const source = await tempDir('brot-restore-source-');
  await runBackup({ out: source }, { home, stdout: capture(), now: () => FIXED });
  return { source, home };
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

describe('brot restore', () => {
  it('restores a backup into a fresh home and verifies the database', async () => {
    const { source } = await makeSource();
    const target = join(await tempDir(), 'home');
    const stdout = capture();

    expect(await runRestore({ from: source }, { home: target, stdout })).toBe(0);
    expect(stdout.text()).toContain(`Restored ${target} from ${source}`);
    expect(stdout.text()).toContain('bots: 1');
    expect(stdout.text()).toContain('threads: 2');

    expect(await readFile(join(target, 'attachments', 'note.txt'), 'utf8')).toBe('attachment bytes');
    expect(await readFile(join(target, 'providers.json'), 'utf8')).toBe('{"providers":[]}\n');
    expect(await readFile(join(target, 'vault.json'), 'utf8')).toBe('{"sealed":true}\n');
    expect((await stat(join(target, 'vault.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(target, 'vault.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(target)).mode & 0o777).toBe(0o700);

    expect(await countsOf(join(target, 'brot.db'))).toEqual({ bots: 1, threads: 2 });
    const handle = await createDb(`file:${join(target, 'brot.db')}`);
    try {
      const bots = await createRepos(handle.db).bots.list({ includeArchived: true });
      expect(bots.map((bot) => bot.name)).toEqual(['Ada']);
    } finally {
      handle.client.close();
    }
  });

  it('never writes to the source directory', async () => {
    const { source } = await makeSource();
    const before = {
      database: await readFile(join(source, 'brot.db')),
      manifest: await readFile(join(source, 'manifest.json'), 'utf8'),
    };
    const target = join(await tempDir(), 'home');
    expect(await runRestore({ from: source }, { home: target, stdout: capture() })).toBe(0);

    expect(await readFile(join(source, 'brot.db'))).toEqual(before.database);
    expect(await readFile(join(source, 'manifest.json'), 'utf8')).toBe(before.manifest);
  });

  it('removes stale wal and shm files from the target with --force', async () => {
    const { source } = await makeSource();
    const target = join(await tempDir(), 'home');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'brot.db-wal'), 'stale wal');
    await writeFile(join(target, 'brot.db-shm'), 'stale shm');

    expect(await runRestore({ from: source, force: true }, { home: target, stdout: capture() })).toBe(0);
    await expect(stat(join(target, 'brot.db-wal'))).rejects.toThrow();
    await expect(stat(join(target, 'brot.db-shm'))).rejects.toThrow();
    expect(await countsOf(join(target, 'brot.db'))).toEqual({ bots: 1, threads: 2 });
  });

  it('refuses a non-empty target without --force and overwrites it with --force', async () => {
    const { source } = await makeSource();
    const target = join(await tempDir(), 'home');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'note.txt'), 'mine');
    await writeFile(join(target, 'brot.db'), 'not a database');

    await expect(runRestore({ from: source }, { home: target, stdout: capture() })).rejects.toThrow(
      /not empty; stop Brot and pass --force/,
    );
    expect(await readFile(join(target, 'brot.db'), 'utf8')).toBe('not a database');

    expect(await runRestore({ from: source, force: true }, { home: target, stdout: capture() })).toBe(0);
    expect(await readFile(join(target, 'note.txt'), 'utf8')).toBe('mine');
    expect(await countsOf(join(target, 'brot.db'))).toEqual({ bots: 1, threads: 2 });
  });

  it('rejects a missing, malformed or incomplete backup', async () => {
    const empty = await tempDir();
    await expect(runRestore({ from: empty }, { home: join(empty, 'home'), stdout: capture() })).rejects.toThrow(
      /no backup manifest at/,
    );

    const invalid = await tempDir();
    await writeFile(join(invalid, 'manifest.json'), '{not json');
    await expect(runRestore({ from: invalid }, { home: join(invalid, 'home'), stdout: capture() })).rejects.toThrow(
      /not valid JSON/,
    );

    const wrong = await tempDir();
    await writeFile(join(wrong, 'brot.db'), 'x');
    await writeFile(
      join(wrong, 'manifest.json'),
      JSON.stringify({ format: 'some-other-backup', version: 1, createdAt: FIXED.toISOString(), includesSecrets: false, files: ['brot.db'] }),
    );
    await expect(runRestore({ from: wrong }, { home: join(wrong, 'home'), stdout: capture() })).rejects.toThrow(
      /is not a Brot backup/,
    );
  });

  it('rejects a backup whose manifest lists a file that is gone', async () => {
    const { source } = await makeSource();
    const broken = await tempDir();
    await cp(source, broken, { recursive: true });
    await rm(join(broken, 'providers.json'));
    await expect(runRestore({ from: broken }, { home: join(broken, 'home'), stdout: capture() })).rejects.toThrow(
      /incomplete: missing providers.json/,
    );
  });

  it('rejects a backup that claims secrets but lacks the vault files', async () => {
    const { source } = await makeSource();
    const broken = await tempDir();
    await cp(source, broken, { recursive: true });
    await rm(join(broken, 'vault.key'));
    await expect(runRestore({ from: broken }, { home: join(broken, 'home'), stdout: capture() })).rejects.toThrow(
      /incomplete: missing vault.key/,
    );
  });
});
