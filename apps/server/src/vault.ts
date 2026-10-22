import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** Secret names appear in URL paths and in `secret://` references. */
export const SecretName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'Use letters, digits, dot, dash or underscore');

/** The vault names holding one saved login's three values. The API stores these names, never the values. */
export interface SavedLoginSecretNames {
  username: string;
  password: string;
  totp: string;
}

/** The vault names for a saved login's values, derived from its id so they are stable across updates. */
export function savedLoginSecretNames(loginId: string): SavedLoginSecretNames {
  return {
    username: `login.${loginId}.username`,
    password: `login.${loginId}.password`,
    totp: `login.${loginId}.totp`,
  };
}

export const SecretBody = z.object({
  value: z.string().min(1).max(65_536),
});

const SealedValue = z.object({ iv: z.string(), tag: z.string(), data: z.string() });
const VaultFile = z.object({
  version: z.literal(1),
  secrets: z.record(z.string(), SealedValue),
});
type SealedValue = z.infer<typeof SealedValue>;
type VaultFile = z.infer<typeof VaultFile>;

export interface Vault {
  set(name: string, value: string): Promise<void>;
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<boolean>;
  /** Secret names only. Values never leave the vault through this method. */
  list(): Promise<string[]>;
  /** Internal use only: resolves a `secret://name` reference. Never expose through HTTP. */
  resolveRef(ref: string): Promise<string | undefined>;
}

/**
 * Secrets are sealed with AES-256-GCM under a 32-byte key in `vault.key` (mode 0600).
 * The secret name is bound as additional authenticated data, so a sealed value cannot be moved under another name.
 */
export function createVault(options: { dir: string }): Vault {
  const keyPath = join(options.dir, 'vault.key');
  const vaultPath = join(options.dir, 'vault.json');
  let keyPromise: Promise<Buffer> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  function loadKey(): Promise<Buffer> {
    keyPromise ??= (async () => {
      try {
        const existing = await readFile(keyPath);
        if (existing.length !== 32) throw new Error(`vault key at ${keyPath} is not 32 bytes`);
        return existing;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const key = randomBytes(32);
      await writeFile(keyPath, key, { mode: 0o600, flag: 'wx' });
      await chmod(keyPath, 0o600);
      return key;
    })();
    return keyPromise;
  }

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function readFileState(): Promise<VaultFile> {
    try {
      return VaultFile.parse(JSON.parse(await readFile(vaultPath, 'utf8')));
    } catch (error) {
      if (isMissing(error)) return { version: 1, secrets: {} };
      throw error;
    }
  }

  async function writeFileState(state: VaultFile): Promise<void> {
    const tmp = `${vaultPath}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await rename(tmp, vaultPath);
  }

  return {
    async set(name, value) {
      SecretName.parse(name);
      const key = await loadKey();
      await exclusive(async () => {
        const state = await readFileState();
        state.secrets[name] = seal(key, name, value);
        await writeFileState(state);
      });
    },

    async has(name) {
      const state = await readFileState();
      return Object.hasOwn(state.secrets, name);
    },

    async delete(name) {
      return exclusive(async () => {
        const state = await readFileState();
        if (!Object.hasOwn(state.secrets, name)) return false;
        delete state.secrets[name];
        await writeFileState(state);
        return true;
      });
    },

    async list() {
      const state = await readFileState();
      return Object.keys(state.secrets).sort();
    },

    async resolveRef(ref) {
      const match = /^secret:\/\/(.+)$/.exec(ref);
      if (!match?.[1]) return undefined;
      const name = match[1];
      const state = await readFileState();
      if (!Object.hasOwn(state.secrets, name)) return undefined;
      const sealed = state.secrets[name];
      if (!sealed) return undefined;
      return open(await loadKey(), name, sealed);
    },
  };
}

function seal(key: Buffer, name: string, value: string): SealedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(name, 'utf8'));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function open(key: Buffer, name: string, sealed: SealedValue): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(name, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
