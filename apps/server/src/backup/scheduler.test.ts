import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngineRegistry, createMockEngine } from '@brot/engines';
import { createDb, createRepos, migrate, type BrotDb } from '@brot/db';
import { loadConfig } from '../config';
import { createServices } from '../services';
import { startServer } from '../index';
import { listBackups } from './list';
import { BACKUP_CHECK_INTERVAL_MS, createBackupScheduler, type BackupSchedulerTimers } from './scheduler';
import { createBackupService, type BackupService } from './service';
import { getBackupSettings, saveBackupSettings, type BackupSettings } from './settings';

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-backup-scheduler-'));
  dirs.push(dir);
  return dir;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeState {
  settings: BackupSettings;
  runs: number;
  activity: number;
  failures: string[];
  fail?: Error;
}

function fakeService(state: FakeState): BackupService {
  return {
    home: '/tmp/fake-home',
    getSettings: async () => state.settings,
    saveSettings: async (update) => {
      state.settings = { ...state.settings, ...update };
      return state.settings;
    },
    list: async () => [],
    nextRunAt: async () => undefined,
    createNow: async () => {
      throw new Error('not used in scheduler tests');
    },
    runScheduled: async (now) => {
      if (state.fail !== undefined) throw state.fail;
      state.runs += 1;
      state.settings = { ...state.settings, lastRunAt: now.toISOString(), lastBackupName: 'brot-test' };
      return {
        backup: { name: 'brot-test', createdAt: now.toISOString(), sizeBytes: 10, includesSecrets: true },
        pruned: [],
      };
    },
    recordFailure: async (error) => {
      state.failures.push(error instanceof Error ? error.message : String(error));
    },
  };
}

function enabled(overrides: Partial<BackupSettings> = {}): BackupSettings {
  return { enabled: true, intervalHours: 1, keep: 2, ...overrides };
}

describe('backup scheduler', () => {
  it('does nothing while backups are disabled', async () => {
    const state: FakeState = { settings: { enabled: false, intervalHours: 1, keep: 2 }, runs: 0, activity: 0, failures: [] };
    const scheduler = createBackupScheduler({
      service: fakeService(state),
      recordActivity: async () => {
        state.activity += 1;
      },
    });
    expect(await scheduler.tick()).toEqual({ status: 'disabled' });
    expect(state.runs).toBe(0);
  });

  it('skips a backup that is not due yet', async () => {
    const state: FakeState = {
      settings: enabled({ lastRunAt: '2026-10-23T10:00:00.000Z' }),
      runs: 0,
      activity: 0,
      failures: [],
    };
    const scheduler = createBackupScheduler({
      service: fakeService(state),
      now: () => new Date('2026-10-23T10:30:00.000Z'),
    });
    expect(await scheduler.tick()).toEqual({ status: 'not-due' });
    expect(state.runs).toBe(0);
  });

  it('runs a due backup once, then skips until the interval passes', async () => {
    const state: FakeState = { settings: enabled(), runs: 0, activity: 0, failures: [] };
    let now = new Date('2026-10-23T10:00:00.000Z');
    const scheduler = createBackupScheduler({
      service: fakeService(state),
      now: () => now,
      recordActivity: async () => {
        state.activity += 1;
      },
    });

    expect((await scheduler.tick()).status).toBe('ran');
    expect(state.runs).toBe(1);
    expect(state.activity).toBe(1);
    expect(await scheduler.tick()).toEqual({ status: 'not-due' });

    now = new Date('2026-10-23T11:01:00.000Z');
    expect((await scheduler.tick()).status).toBe('ran');
    expect(state.runs).toBe(2);
  });

  it('records a failure without throwing', async () => {
    const state: FakeState = {
      settings: enabled(),
      runs: 0,
      activity: 0,
      failures: [],
      fail: new Error('disk is full'),
    };
    const scheduler = createBackupScheduler({
      service: fakeService(state),
      recordActivity: async () => {
        state.activity += 1;
      },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await scheduler.tick()).toEqual({ status: 'failed', error: 'disk is full' });
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    expect(state.failures).toEqual(['disk is full']);
    expect(state.activity).toBe(0);
  });

  it('starts an unref-style check timer and stops it', async () => {
    const state: FakeState = { settings: enabled(), runs: 0, activity: 0, failures: [] };
    const intervals: Array<{ callback: () => void; ms: number }> = [];
    const cleared: unknown[] = [];
    const timers: BackupSchedulerTimers = {
      setInterval: (callback, ms) => {
        intervals.push({ callback, ms });
        return 'handle';
      },
      clearInterval: (handle) => {
        cleared.push(handle);
      },
    };
    const scheduler = createBackupScheduler({ service: fakeService(state), timers });
    scheduler.start();
    scheduler.start();
    await settle();
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.ms).toBe(BACKUP_CHECK_INTERVAL_MS);
    expect(state.runs).toBe(1);

    intervals[0]?.callback();
    await settle();
    expect(state.runs).toBe(1);

    scheduler.stop();
    expect(cleared).toEqual(['handle']);
    scheduler.stop();
    expect(cleared).toHaveLength(1);
  });

  it('creates and prunes backups through the real service', async () => {
    const home = await tempDir();
    const handle: BrotDb = await createDb(`file:${join(home, 'brot.db')}`);
    await migrate(handle.db);
    try {
      const repos = createRepos(handle.db);
      await writeFile(join(home, 'vault.json'), '{"sealed":true}\n');
      await writeFile(join(home, 'vault.key'), 'k'.repeat(32));
      await saveBackupSettings(repos, { enabled: true, intervalHours: 1, keep: 1 });
      const service = createBackupService({ repos, home, now: () => new Date('2026-10-23T02:00:00.000Z') });
      const scheduler = createBackupScheduler({ service, now: () => new Date('2026-10-23T02:00:00.000Z') });

      expect((await scheduler.tick()).status).toBe('ran');
      expect(await listBackups(home)).toHaveLength(1);
      expect((await getBackupSettings(repos)).lastBackupName).toBe(
        `brot-2026-10-23T02:00:00.000Z`,
      );
      expect((await stat(join(home, 'backups', 'brot-2026-10-23T02:00:00.000Z', 'vault.key'))).mode & 0o777).toBe(0o600);

      const second = createBackupScheduler({
        service: createBackupService({ repos, home, now: () => new Date('2026-10-23T03:00:00.000Z') }),
        now: () => new Date('2026-10-23T03:00:00.000Z'),
      });
      expect((await second.tick()).status).toBe('ran');
      expect(await listBackups(home)).toHaveLength(1);
    } finally {
      handle.client.close();
    }
  });

  it('is started by startServer and runs a due backup at boot', async () => {
    const home = await tempDir();
    await writeFile(join(home, 'vault.json'), '{"sealed":true}\n');
    await writeFile(join(home, 'vault.key'), 'k'.repeat(32));
    const config = loadConfig({ BROT_HOME: home });
    const services = await createServices(config, createEngineRegistry([createMockEngine()]));
    await services.backups.saveSettings({ enabled: true, intervalHours: 1, keep: 2 });
    await services.close();

    const server = await startServer({ home, host: '127.0.0.1', port: 0, webhookPort: 0 });
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && (await listBackups(home)).length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const entries = await listBackups(home);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.includesSecrets).toBe(true);
    } finally {
      await server.close();
    }
  });
});
