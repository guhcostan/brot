/** How backups are scheduled, from `GET /api/backups.settings`. */
export interface BackupSettings {
  enabled: boolean;
  /** Hours between scheduled backups, 1..168. */
  intervalHours: number;
  /** How many backups to keep, 1..30. */
  keep: number;
  lastRunAt?: string;
  lastBackupName?: string;
  lastError?: string;
}

/** One backup folder on the server machine. */
export interface BackupEntry {
  name: string;
  createdAt: string;
  sizeBytes: number;
  /** Scheduled backups include the encrypted vault; this is a flag, never the secrets themselves. */
  includesSecrets: boolean;
}

/** `GET /api/backups`: the settings, the recent backups and the scheduled next run. */
export interface BackupStatus {
  settings: BackupSettings;
  backups: BackupEntry[];
  nextRunAt?: string;
}

export interface UpdateBackupSettings {
  enabled?: boolean;
  intervalHours?: number;
  keep?: number;
}

export const BACKUP_INTERVAL_MIN = 1;
export const BACKUP_INTERVAL_MAX = 168;
export const BACKUP_KEEP_MIN = 1;
export const BACKUP_KEEP_MAX = 30;

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { enabled: false, intervalHours: 24, keep: 5 };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const boundedCount = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;

/** Why a settings form value is not acceptable, or undefined when it is fine. */
export function intervalHoursProblem(value: string): boolean {
  const parsed = Number(value);
  return !Number.isInteger(parsed) || parsed < BACKUP_INTERVAL_MIN || parsed > BACKUP_INTERVAL_MAX;
}

export function keepProblem(value: string): boolean {
  const parsed = Number(value);
  return !Number.isInteger(parsed) || parsed < BACKUP_KEEP_MIN || parsed > BACKUP_KEEP_MAX;
}

/** Validates a PUT body before sending: at least one field, and every count inside its range. */
export function validateUpdateBackupSettings(patch: UpdateBackupSettings): UpdateBackupSettings {
  if (patch.enabled === undefined && patch.intervalHours === undefined && patch.keep === undefined) {
    throw new Error('A backup settings patch needs at least one field');
  }
  if (patch.intervalHours !== undefined && boundedCount(patch.intervalHours, BACKUP_INTERVAL_MIN, BACKUP_INTERVAL_MAX) === undefined) {
    throw new Error(`intervalHours must be ${BACKUP_INTERVAL_MIN}..${BACKUP_INTERVAL_MAX}`);
  }
  if (patch.keep !== undefined && boundedCount(patch.keep, BACKUP_KEEP_MIN, BACKUP_KEEP_MAX) === undefined) {
    throw new Error(`keep must be ${BACKUP_KEEP_MIN}..${BACKUP_KEEP_MAX}`);
  }
  return {
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.intervalHours === undefined ? {} : { intervalHours: patch.intervalHours }),
    ...(patch.keep === undefined ? {} : { keep: patch.keep }),
  };
}

function parseBackupEntry(value: unknown): BackupEntry {
  if (!isRecord(value)) throw new Error('Expected a backup entry');
  if (typeof value.name !== 'string' || typeof value.createdAt !== 'string') throw new Error('Expected a backup entry');
  if (typeof value.sizeBytes !== 'number' || value.sizeBytes < 0) throw new Error('Expected a backup size');
  return {
    name: value.name,
    createdAt: value.createdAt,
    sizeBytes: value.sizeBytes,
    includesSecrets: value.includesSecrets === true,
  };
}

export function parseBackupEntryValue(value: unknown): BackupEntry {
  return parseBackupEntry(value);
}

/** Reads `GET /api/backups` without trusting it; malformed settings fall back to the defaults. */
export function parseBackupStatus(value: unknown): BackupStatus {
  const record = isRecord(value) ? value : {};
  const rawSettings = isRecord(record.settings) ? record.settings : {};
  const settings: BackupSettings = {
    enabled: rawSettings.enabled === true,
    intervalHours: boundedCount(rawSettings.intervalHours, BACKUP_INTERVAL_MIN, BACKUP_INTERVAL_MAX) ?? DEFAULT_BACKUP_SETTINGS.intervalHours,
    keep: boundedCount(rawSettings.keep, BACKUP_KEEP_MIN, BACKUP_KEEP_MAX) ?? DEFAULT_BACKUP_SETTINGS.keep,
    ...(typeof rawSettings.lastRunAt === 'string' ? { lastRunAt: rawSettings.lastRunAt } : {}),
    ...(typeof rawSettings.lastBackupName === 'string' ? { lastBackupName: rawSettings.lastBackupName } : {}),
    ...(typeof rawSettings.lastError === 'string' ? { lastError: rawSettings.lastError } : {}),
  };
  const backups = Array.isArray(record.backups) ? record.backups.map(parseBackupEntry) : [];
  return {
    settings,
    backups: [...backups].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    ...(typeof record.nextRunAt === 'string' ? { nextRunAt: record.nextRunAt } : {}),
  };
}
