import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminActivity } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';
import { createBackup, type BackupEntry } from './create';
import { backupsDirectory } from './list';
import type { BackupSettings } from './settings';

interface BackupState {
  settings: BackupSettings;
  backups: BackupEntry[];
  nextRunAt?: string;
}

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function state(): Promise<BackupState> {
  const response = await call(ctx.app, 'GET', '/api/backups');
  expect(response.status).toBe(200);
  return json<BackupState>(response);
}

async function activity(): Promise<AdminActivity[]> {
  return json<AdminActivity[]>(await call(ctx.app, 'GET', '/api/activity'));
}

async function writeVault(): Promise<void> {
  await writeFile(join(ctx.dir, 'vault.json'), '{"sealed":true}\n');
  await writeFile(join(ctx.dir, 'vault.key'), 'k'.repeat(32));
}

describe('GET /api/backups', () => {
  it('returns the defaults with no backups and no next run while disabled', async () => {
    const body = await state();
    expect(body.settings).toEqual({ enabled: false, intervalHours: 24, keep: 5 });
    expect(body.backups).toEqual([]);
    expect(body.nextRunAt).toBeUndefined();
    expect(await activity()).toEqual([]);
  });
});

describe('PUT /api/backups', () => {
  it('saves the scheduling knobs and records an activity entry', async () => {
    const response = await call(ctx.app, 'PUT', '/api/backups', { enabled: true, intervalHours: 6, keep: 3 });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ enabled: true, intervalHours: 6, keep: 3 });

    const body = await state();
    expect(body.settings).toMatchObject({ enabled: true, intervalHours: 6, keep: 3 });
    expect(body.nextRunAt).toBeDefined();

    const entries = await activity();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'updated',
      targetType: 'backup',
      summary: 'Updated backup settings',
      actor: 'local',
    });
  });

  it('accepts an empty body as a no-op and keeps the run bookkeeping', async () => {
    await writeVault();
    expect((await call(ctx.app, 'POST', '/api/backups/run')).status).toBe(201);
    const before = await state();
    const response = await call(ctx.app, 'PUT', '/api/backups', {});
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      lastRunAt: before.settings.lastRunAt,
      lastBackupName: before.settings.lastBackupName,
    });
  });

  it('refuses invalid values with 400 and changes nothing', async () => {
    for (const body of [
      { intervalHours: 0 },
      { intervalHours: 169 },
      { intervalHours: 1.5 },
      { keep: 0 },
      { keep: 31 },
      { enabled: 'yes' },
    ]) {
      const response = await call(ctx.app, 'PUT', '/api/backups', body);
      expect(response.status).toBe(400);
    }
    expect((await state()).settings).toEqual({ enabled: false, intervalHours: 24, keep: 5 });
    expect(await activity()).toEqual([]);
  });
});

describe('POST /api/backups/run', () => {
  it('creates a backup with secrets, lists it, and records activity without leaking files or paths', async () => {
    await writeVault();
    const response = await call(ctx.app, 'POST', '/api/backups/run');
    expect(response.status).toBe(201);
    const entry = await json<BackupEntry>(response);
    expect(entry).toMatchObject({ includesSecrets: true });
    expect(entry.name).toMatch(/^brot-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(entry.createdAt).toMatch(/^20/);
    expect(entry.sizeBytes).toBeGreaterThan(0);
    // The API shows the backup, never its filesystem location or file list.
    expect(Object.keys(entry).sort()).toEqual(['createdAt', 'includesSecrets', 'name', 'sizeBytes']);
    expect(JSON.stringify(entry)).not.toContain(ctx.dir);

    const directory = join(backupsDirectory(ctx.dir), entry.name);
    await expect(stat(join(directory, 'brot.db'))).resolves.toBeDefined();
    expect((await stat(join(directory, 'vault.key'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, 'vault.json'))).mode & 0o777).toBe(0o600);

    const body = await state();
    expect(body.backups).toEqual([entry]);
    expect(body.settings.lastBackupName).toBe(entry.name);
    expect(body.settings.lastRunAt).toBeDefined();
    expect(body.nextRunAt).toBeUndefined(); // still disabled

    const entries = await activity();
    expect(entries[0]).toMatchObject({ action: 'created', targetType: 'backup', summary: 'Created backup' });
  });

  it('never returns database bytes, vault bytes or paths in any response', async () => {
    await writeVault();
    const created = await call(ctx.app, 'POST', '/api/backups/run');
    const createdText = await created.text();
    const stateText = await (await call(ctx.app, 'GET', '/api/backups')).text();
    for (const text of [createdText, stateText]) {
      expect(text).not.toContain('SQLite format 3');
      expect(text).not.toContain('k'.repeat(32));
      expect(text).not.toContain(ctx.dir);
      expect(text).not.toContain('vault.key');
    }
  });

  it('lists backups under the home, newest first, and ignores foreign directories', async () => {
    await writeVault();
    const older = await createBackup(
      { home: ctx.dir, out: join(backupsDirectory(ctx.dir), 'brot-2026-10-20T10:00:00.000Z') },
      { now: () => new Date('2026-10-20T10:00:00.000Z') },
    );
    const newer = await createBackup(
      { home: ctx.dir, out: join(backupsDirectory(ctx.dir), 'brot-2026-10-22T10:00:00.000Z') },
      { now: () => new Date('2026-10-22T10:00:00.000Z') },
    );
    await writeFile(join(backupsDirectory(ctx.dir), 'notes.txt'), 'not a backup');

    const body = await state();
    expect(body.backups.map((entry) => entry.name)).toEqual([newer.name, older.name]);
  });
});
