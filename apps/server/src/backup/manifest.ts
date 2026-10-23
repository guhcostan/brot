import { IsoDateTime } from '@brot/protocol';
import { z } from 'zod';

/** What a manifest must say to be a Brot backup this build can restore. */
export const BACKUP_FORMAT = 'brot-backup';
export const BACKUP_VERSION = 1;

export const BackupManifest = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  createdAt: IsoDateTime,
  includesSecrets: z.boolean(),
  /** Paths relative to the backup directory. `brot.db` is always present. */
  files: z.array(z.string().min(1)),
});
export type BackupManifest = z.infer<typeof BackupManifest>;

/** The directory name `createBackup` gives a backup inside `<home>/backups`: `brot-<ISO timestamp>`. */
export const BACKUP_DIRECTORY_PATTERN = /^brot-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Whether a directory name is one of the backups the list/prune commands own. */
export function isBackupDirectoryName(name: string): boolean {
  return BACKUP_DIRECTORY_PATTERN.test(name);
}
