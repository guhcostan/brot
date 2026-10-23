import { createBackup } from '@brot/server';
import type { BackupFs } from '@brot/server';
import type { Writer } from '../io';

export { BackupManifest } from '@brot/server';
export type { BackupFs } from '@brot/server';

export interface BackupOptions {
  /** Default: `<home>/backups/brot-<createdAt>`. */
  out?: string;
  noSecrets?: boolean;
  /** Write into a non-empty destination. */
  force?: boolean;
}

export interface BackupDeps {
  home: string;
  stdout: Writer;
  fs?: BackupFs;
  now?: () => Date;
}

/**
 * `brot backup`: a thin wrapper over the server's backup core, so the CLI and the server write the same format.
 * Prints the summary the command has always printed. Returns the process exit code.
 */
export async function runBackup(options: BackupOptions, deps: BackupDeps): Promise<number> {
  const created = await createBackup(
    {
      home: deps.home,
      ...(options.out === undefined ? {} : { out: options.out }),
      includeSecrets: options.noSecrets !== true,
      force: options.force === true,
    },
    {
      ...(deps.fs === undefined ? {} : { fs: deps.fs }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    },
  );

  deps.stdout.write(`Backup written to ${created.path}\n`);
  deps.stdout.write(`files: ${created.files.join(', ')}\n`);
  deps.stdout.write(`size: ${created.sizeBytes} bytes\n`);
  if (created.includesSecrets) {
    deps.stdout.write('secrets: included (vault.json, vault.key). Keep this backup private.\n');
  } else {
    deps.stdout.write('secrets: not included\n');
  }
  return 0;
}
