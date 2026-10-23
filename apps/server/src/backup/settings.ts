import type { Repos } from '@brot/db';
import { IsoDateTime } from '@brot/protocol';
import { z } from 'zod';

/** The settings key the scheduled-backup configuration lives under. */
export const BACKUP_SETTINGS_KEY = 'backups';

export const BACKUP_INTERVAL_HOURS_MIN = 1;
export const BACKUP_INTERVAL_HOURS_MAX = 168;
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 30;

/** Scheduled backup settings, including the outcome of the last run. Stored as one settings row. */
export const BackupSettings = z.object({
  enabled: z.boolean().default(false),
  intervalHours: z.number().int().min(BACKUP_INTERVAL_HOURS_MIN).max(BACKUP_INTERVAL_HOURS_MAX).default(24),
  keep: z.number().int().min(BACKUP_KEEP_MIN).max(BACKUP_KEEP_MAX).default(5),
  lastRunAt: IsoDateTime.optional(),
  lastBackupName: z.string().min(1).max(200).optional(),
  lastError: z.string().max(2000).optional(),
});
export type BackupSettings = z.infer<typeof BackupSettings>;

/** What PUT /api/backups accepts: only the scheduling knobs, never the run bookkeeping. */
export const UpdateBackupSettings = z.object({
  enabled: z.boolean().optional(),
  intervalHours: z.number().int().min(BACKUP_INTERVAL_HOURS_MIN).max(BACKUP_INTERVAL_HOURS_MAX).optional(),
  keep: z.number().int().min(BACKUP_KEEP_MIN).max(BACKUP_KEEP_MAX).optional(),
});
export type UpdateBackupSettings = z.infer<typeof UpdateBackupSettings>;

/** The defaults every home starts with: off, daily, keep five. */
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = BackupSettings.parse({});

/** How long one interval is, in milliseconds. */
export function backupIntervalMs(settings: BackupSettings): number {
  return settings.intervalHours * 60 * 60 * 1000;
}

/** Whether the next scheduler tick should run a backup. An enabled backup with no last run is due immediately. */
export function backupIsDue(settings: BackupSettings, now: Date = new Date()): boolean {
  if (!settings.enabled) return false;
  const last = settings.lastRunAt === undefined ? 0 : Date.parse(settings.lastRunAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= backupIntervalMs(settings);
}

/** When the next scheduled backup should run, for the API. Absent while disabled. */
export function nextBackupAt(settings: BackupSettings, now: Date = new Date()): string | undefined {
  if (!settings.enabled) return undefined;
  const last = settings.lastRunAt === undefined ? 0 : Date.parse(settings.lastRunAt);
  const due = Number.isNaN(last) ? now.getTime() : last + backupIntervalMs(settings);
  return new Date(Math.max(now.getTime(), due)).toISOString();
}

/** The stored backup settings, or the built-in defaults. */
export async function getBackupSettings(repos: Pick<Repos, 'settings'>): Promise<BackupSettings> {
  return (await repos.settings.get(BACKUP_SETTINGS_KEY, BackupSettings)) ?? { ...DEFAULT_BACKUP_SETTINGS };
}

/** Merges an update over the current settings (keeping last-run bookkeeping) and stores the result. */
export async function saveBackupSettings(
  repos: Pick<Repos, 'settings'>,
  update: UpdateBackupSettings,
): Promise<BackupSettings> {
  const current = await getBackupSettings(repos);
  const settings = BackupSettings.parse({ ...current, ...update });
  await repos.settings.set(BACKUP_SETTINGS_KEY, settings);
  return settings;
}

/** Persists the outcome of one backup attempt, leaving the scheduling knobs untouched. */
export async function recordBackupOutcome(
  repos: Pick<Repos, 'settings'>,
  outcome: { at?: string; name?: string; error?: string },
): Promise<BackupSettings> {
  const current = await getBackupSettings(repos);
  const merged: Record<string, unknown> = { ...current };
  if (outcome.at !== undefined) merged.lastRunAt = outcome.at;
  if (outcome.name !== undefined) merged.lastBackupName = outcome.name;
  if (outcome.error !== undefined) merged.lastError = outcome.error.slice(0, 2000);
  // A successful run clears the previous failure.
  else if (outcome.at !== undefined) delete merged.lastError;
  const settings = BackupSettings.parse(merged);
  await repos.settings.set(BACKUP_SETTINGS_KEY, settings);
  return settings;
}
