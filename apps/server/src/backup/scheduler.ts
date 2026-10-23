import type { BackupEntry } from './create';
import { backupIsDue } from './settings';
import type { BackupService } from './service';

/** How often the scheduler checks whether a backup is due. */
export const BACKUP_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Timer seam so tests can drive ticks without waiting for real time. */
export interface BackupSchedulerTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const REAL_TIMERS: BackupSchedulerTimers = {
  setInterval(callback, ms) {
    const timer = setInterval(callback, ms);
    timer.unref();
    return timer;
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

/** What one scheduler check did. */
export type BackupSchedulerTick =
  | { status: 'disabled' }
  | { status: 'not-due' }
  | { status: 'ran'; backup: BackupEntry; pruned: string[] }
  | { status: 'failed'; error: string };

export interface BackupSchedulerDeps {
  service: BackupService;
  /** Called after a scheduled backup succeeded; best effort, its failure is only logged. */
  recordActivity?: () => Promise<void>;
  now?: () => Date;
  timers?: BackupSchedulerTimers;
  /** Defaults to `BACKUP_CHECK_INTERVAL_MS`. */
  intervalMs?: number;
}

export interface BackupScheduler {
  /** Starts the check timer and runs one check right away. Safe to call twice. */
  start(): void;
  stop(): void;
  nextRunAt(): Promise<string | undefined>;
  /** One check. Never throws: failures are recorded in the settings and logged. */
  tick(): Promise<BackupSchedulerTick>;
}

export function createBackupScheduler(deps: BackupSchedulerDeps): BackupScheduler {
  const timers = deps.timers ?? REAL_TIMERS;
  const clock = deps.now ?? (() => new Date());
  let timer: unknown;
  let started = false;
  let running = false;

  async function tick(): Promise<BackupSchedulerTick> {
    if (running) return { status: 'not-due' };
    running = true;
    try {
      const now = clock();
      const settings = await deps.service.getSettings();
      if (!settings.enabled) return { status: 'disabled' };
      if (!backupIsDue(settings, now)) return { status: 'not-due' };
      const { backup, pruned } = await deps.service.runScheduled(now);
      try {
        await deps.recordActivity?.();
      } catch (error) {
        console.error('could not record scheduled backup activity', error);
      }
      return { status: 'ran', backup, pruned };
    } catch (error) {
      console.error('scheduled backup failed', error);
      await deps.service.recordFailure(error);
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (started) return;
      started = true;
      void tick();
      timer = timers.setInterval(() => {
        void tick();
      }, deps.intervalMs ?? BACKUP_CHECK_INTERVAL_MS);
    },

    stop() {
      if (!started) return;
      started = false;
      timers.clearInterval(timer);
      timer = undefined;
    },

    async nextRunAt() {
      return deps.service.nextRunAt();
    },

    tick,
  };
}
