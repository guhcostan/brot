import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrate } from '@brot/db';
import { createBackup } from './create';
import { backupsDirectory, listBackups, pruneBackups } from './list';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix = 'brot-backup-list-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function makeHome(): Promise<string> {
  const home = await tempDir('brot-backup-list-home-');
  const db = await createDb(`file:${join(home, 'brot.db')}`);
  await migrate(db.db);
  db.client.close();
  return home;
}

async function backupAt(home: string, iso: string): Promise<string> {
  const created = await createBackup(
    { home, out: join(backupsDirectory(home), `brot-${iso}`), force: true },
    { now: () => new Date(iso) },
  );
  return created.name;
}

describe('listBackups', () => {
  it('lists only brot-<ISO> directories with a valid manifest, newest first', async () => {
    const home = await makeHome();
    const older = await backupAt(home, '2026-10-20T10:00:00.000Z');
    const newer = await backupAt(home, '2026-10-22T10:00:00.000Z');
    // Foreign entries are left alone and never listed.
    await mkdir(join(backupsDirectory(home), 'notes'), { recursive: true });
    await writeFile(join(backupsDirectory(home), 'notes', 'x.txt'), 'x');
    await mkdir(join(backupsDirectory(home), 'brot-not-a-date'), { recursive: true });
    await mkdir(join(backupsDirectory(home), 'brot-2026-10-21T10:00:00.000Z'), { recursive: true });

    const entries = await listBackups(home);
    expect(entries.map((entry) => entry.name)).toEqual([newer, older]);
    expect(entries[0]).toMatchObject({ createdAt: '2026-10-22T10:00:00.000Z', includesSecrets: false });
    expect(entries[0]?.sizeBytes).toBeGreaterThan(0);

    expect(await listBackups(await tempDir())).toEqual([]);
  });
});

describe('pruneBackups', () => {
  it('keeps the newest N and deletes only its own backup directories', async () => {
    const home = await makeHome();
    const names = [
      await backupAt(home, '2026-10-18T10:00:00.000Z'),
      await backupAt(home, '2026-10-19T10:00:00.000Z'),
      await backupAt(home, '2026-10-20T10:00:00.000Z'),
    ];
    await mkdir(join(backupsDirectory(home), 'notes'), { recursive: true });
    await writeFile(join(backupsDirectory(home), 'notes', 'x.txt'), 'x');

    const removed = await pruneBackups(home, 2);
    expect(removed).toEqual([names[0]]);
    expect((await listBackups(home)).map((entry) => entry.name)).toEqual([names[2], names[1]]);
    await expect(stat(join(backupsDirectory(home), 'notes', 'x.txt'))).resolves.toBeDefined();

    // keep is clamped: at least one backup always survives.
    expect(await pruneBackups(home, 0)).toEqual([names[2], names[1]].slice(1));
    expect(await listBackups(home)).toHaveLength(1);
  });
});
