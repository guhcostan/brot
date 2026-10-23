import type { Repos } from '@brot/db';
import { createBackup, type BackupEntry, type CreateBackupDeps } from './create';
import type { BackupFs } from './files';
import { listBackups, pruneBackups, type BackupListDeps } from './list';
import {
  getBackupSettings,
  nextBackupAt,
  recordBackupOutcome,
  saveBackupSettings,
  type BackupSettings,
  type UpdateBackupSettings,
} from './settings';

export interface BackupServiceDeps {
  repos: Pick<Repos, 'settings'>;
  /** The Brot home whose database and files are backed up. */
  home: string;
  fs?: BackupFs;
  now?: () => Date;
}

/** What one scheduled run did. */
export interface ScheduledBackupResult {
  backup: BackupEntry;
  pruned: string[];
}

/**
 * The backup operations the server exposes to its routes and scheduler. Backups always include the vault (they
 * stay on the same machine) and live under `<home>/backups`; the CLI handles other destinations and `--no-secrets`.
 */
export interface BackupService {
  readonly home: string;
  getSettings(): Promise<BackupSettings>;
  saveSettings(update: UpdateBackupSettings): Promise<BackupSettings>;
  list(): Promise<BackupEntry[]>;
  /** When the next scheduled backup runs; absent while disabled. */
  nextRunAt(): Promise<string | undefined>;
  /** Creates a backup now (secrets included) and records it as the last run. */
  createNow(): Promise<BackupEntry>;
  /** Creates a scheduled backup, prunes old ones to `keep`, and records the run. */
  runScheduled(now: Date): Promise<ScheduledBackupResult>;
  /** Persists a failure as `lastError`; never throws. */
  recordFailure(error: unknown): Promise<void>;
}

function entryOf(created: BackupEntry): BackupEntry {
  return {
    name: created.name,
    createdAt: created.createdAt,
    sizeBytes: created.sizeBytes,
    includesSecrets: created.includesSecrets,
  };
}

export function createBackupService(deps: BackupServiceDeps): BackupService {
  const { repos, home } = deps;
  const clock = deps.now ?? (() => new Date());
  const createDeps = (now: Date): CreateBackupDeps => ({
    ...(deps.fs === undefined ? {} : { fs: deps.fs }),
    now: () => now,
  });
  const listDeps = (): BackupListDeps => (deps.fs === undefined ? {} : { fs: deps.fs });

  return {
    home,
    getSettings: () => getBackupSettings(repos),
    saveSettings: (update) => saveBackupSettings(repos, update),
    list: () => listBackups(home, listDeps()),
    async nextRunAt() {
      return nextBackupAt(await getBackupSettings(repos), clock());
    },
    async createNow() {
      const now = clock();
      const created = await createBackup({ home, includeSecrets: true, force: true }, createDeps(now));
      await recordBackupOutcome(repos, { at: now.toISOString(), name: created.name });
      return entryOf(created);
    },
    async runScheduled(now) {
      const settings = await getBackupSettings(repos);
      const created = await createBackup({ home, includeSecrets: true, force: true }, createDeps(now));
      const pruned = await pruneBackups(home, settings.keep, listDeps());
      await recordBackupOutcome(repos, { at: now.toISOString(), name: created.name });
      return { backup: entryOf(created), pruned };
    },
    async recordFailure(error) {
      try {
        await recordBackupOutcome(repos, { error: error instanceof Error ? error.message : String(error) });
      } catch (cause) {
        // Recording the failure is itself best effort; the scheduler only logs.
        console.error('could not record scheduled backup failure', cause);
      }
    },
  };
}
