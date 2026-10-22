import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The bytes behind attachments, under `<home>/attachments/<id>`. Files are written atomically with mode 0600
 * and are only reached by id: no filesystem path leaves this module.
 */
export interface AttachmentStorage {
  write(id: string, bytes: Uint8Array): Promise<void>;
  /** The whole file, or undefined when it is missing. */
  read(id: string): Promise<Uint8Array | undefined>;
  /** At most `maxBytes` from the start of the file, or undefined when it is missing. */
  readPrefix(id: string, maxBytes: number): Promise<Uint8Array | undefined>;
  /** Removes the file. Missing files are not an error. */
  remove(id: string): Promise<void>;
  /**
   * Deletes stored files whose ids are not in `keep`: the rows are gone, so nothing can reach them. Only
   * regular files with an id-shaped name are considered; a missing directory removes nothing. Never throws
   * on ENOENT or EACCES.
   */
  sweep(keep: ReadonlySet<string>): Promise<{ removed: number }>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function createAttachmentStorage(options: { home: string }): AttachmentStorage {
  const dir = join(options.home, 'attachments');
  let ready: Promise<void> | undefined;

  function ensureDir(): Promise<void> {
    ready ??= mkdir(dir, { recursive: true, mode: 0o700 }).then(() => undefined);
    return ready;
  }

  /** The stored id is always server-generated, but validating it keeps a caller's id out of the path. */
  function fileOf(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error('invalid attachment id');
    return join(dir, id);
  }

  return {
    async write(id, bytes) {
      const file = fileOf(id);
      await ensureDir();
      const temp = `${file}.${process.pid}.tmp`;
      try {
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
    },

    async read(id) {
      try {
        return new Uint8Array(await readFile(fileOf(id)));
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },

    async readPrefix(id, maxBytes) {
      const file = fileOf(id);
      let handle;
      try {
        handle = await open(file, 'r');
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
      try {
        const size = (await handle.stat()).size;
        const length = Math.max(0, Math.min(maxBytes, size));
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, 0);
        return new Uint8Array(buffer.subarray(0, bytesRead));
      } finally {
        await handle.close();
      }
    },

    async remove(id) {
      await rm(fileOf(id), { force: true });
    },

    async sweep(keep) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (missingOrDenied(error)) return { removed: 0 };
        throw error;
      }
      let removed = 0;
      for (const entry of entries) {
        if (!entry.isFile() || !ID_PATTERN.test(entry.name) || keep.has(entry.name)) continue;
        try {
          await rm(join(dir, entry.name), { force: true });
          removed += 1;
        } catch (error) {
          if (!missingOrDenied(error)) throw error;
        }
      }
      return { removed };
    },
  };
}

/** ENOENT and EACCES mean there is nothing to sweep, or it cannot be reached: not a boot failure. */
function missingOrDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'EACCES')
  );
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
