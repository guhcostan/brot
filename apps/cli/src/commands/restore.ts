import { restoreBackup } from '@brot/server';
import type { BackupFs } from '@brot/server';
import type { Writer } from '../io';

export type { BackupFs } from '@brot/server';

export interface RestoreOptions {
  from: string;
  /** Overwrite a non-empty home (Brot must be stopped). */
  force?: boolean;
}

export interface RestoreDeps {
  home: string;
  stdout: Writer;
  fs?: BackupFs;
}

/**
 * `brot restore`: a thin wrapper over the server's restore core. Validates, copies the backup into the home and
 * prints the bot/thread counts that prove the restored database is usable. Returns the process exit code.
 */
export async function runRestore(options: RestoreOptions, deps: RestoreDeps): Promise<number> {
  const result = await restoreBackup(
    {
      from: options.from,
      home: deps.home,
      ...(options.force === true ? { force: true } : {}),
    },
    deps.fs === undefined ? {} : { fs: deps.fs },
  );

  deps.stdout.write(`Restored ${result.home} from ${result.from}\n`);
  deps.stdout.write(`bots: ${result.bots}\n`);
  deps.stdout.write(`threads: ${result.threads}\n`);
  return 0;
}
