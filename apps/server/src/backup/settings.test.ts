import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import {
  UpdateBackupSettings,
  backupIsDue,
  getBackupSettings,
  nextBackupAt,
  recordBackupOutcome,
  saveBackupSettings,
} from './settings';

let handle: BrotDb;
let repos: Repos;

beforeEach(async () => {
  handle = await createDb(':memory:');
  await migrate(handle.db);
  repos = createRepos(handle.db);
});

afterEach(() => {
  handle.client.close();
});

describe('backup settings', () => {
  it('defaults to off, daily, keep five', async () => {
    expect(await getBackupSettings(repos)).toEqual({ enabled: false, intervalHours: 24, keep: 5 });
    expect(await nextBackupAt(await getBackupSettings(repos), new Date())).toBe(undefined);
    expect(backupIsDue(await getBackupSettings(repos), new Date())).toBe(false);
  });

  it('saves updates and keeps the last-run bookkeeping', async () => {
    const updated = await saveBackupSettings(repos, { enabled: true, intervalHours: 6, keep: 3 });
    expect(updated).toMatchObject({ enabled: true, intervalHours: 6, keep: 3 });

    const at = '2026-10-23T02:00:00.000Z';
    const afterRun = await recordBackupOutcome(repos, { at, name: 'brot-2026-10-23T02:00:00.000Z' });
    expect(afterRun).toMatchObject({ enabled: true, intervalHours: 6, keep: 3, lastRunAt: at });
    expect(afterRun.lastBackupName).toBe('brot-2026-10-23T02:00:00.000Z');

    const onlyKeep = await saveBackupSettings(repos, { keep: 2 });
    expect(onlyKeep).toMatchObject({ enabled: true, intervalHours: 6, keep: 2, lastRunAt: at });
    expect(onlyKeep.lastBackupName).toBe('brot-2026-10-23T02:00:00.000Z');
  });

  it('computes due times and the next run', async () => {
    await saveBackupSettings(repos, { enabled: true, intervalHours: 2 });
    const settings = await getBackupSettings(repos);

    const now = new Date('2026-10-23T12:00:00.000Z');
    // No last run: due at once, and the API reports the next check as now.
    expect(backupIsDue(settings, now)).toBe(true);
    expect(nextBackupAt(settings, now)).toBe(now.toISOString());

    const ran = await recordBackupOutcome(repos, { at: '2026-10-23T06:00:00.000Z', name: 'brot-x' });
    expect(backupIsDue(ran, now)).toBe(true);
    expect(nextBackupAt(ran, now)).toBe(now.toISOString());

    const fresh = await recordBackupOutcome(repos, { at: '2026-10-23T11:30:00.000Z', name: 'brot-y' });
    expect(backupIsDue(fresh, now)).toBe(false);
    expect(nextBackupAt(fresh, now)).toBe('2026-10-23T13:30:00.000Z');
  });

  it('records a failure and clears it on the next success', async () => {
    const failed = await recordBackupOutcome(repos, { error: 'database is locked' });
    expect(failed.lastError).toBe('database is locked');

    const succeeded = await recordBackupOutcome(repos, { at: '2026-10-23T02:00:00.000Z', name: 'brot-x' });
    expect(succeeded.lastError).toBeUndefined();
    expect(succeeded.lastRunAt).toBe('2026-10-23T02:00:00.000Z');
  });

  it('validates the schedule bounds at the boundary', () => {
    expect(UpdateBackupSettings.safeParse({ intervalHours: 1, keep: 1 }).success).toBe(true);
    expect(UpdateBackupSettings.safeParse({ intervalHours: 168, keep: 30 }).success).toBe(true);
    for (const body of [{ intervalHours: 0 }, { intervalHours: 169 }, { intervalHours: 1.5 }, { keep: 0 }, { keep: 31 }, { enabled: 'yes' }]) {
      expect(UpdateBackupSettings.safeParse(body).success).toBe(false);
    }
  });
});
