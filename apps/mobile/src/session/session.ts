import { DeviceRole, IsoDateTime } from '@brot/protocol';
import { z } from 'zod';
import { completePairing, createClient, type FetchLike } from '../api/client';
import { createDeviceKeys, type DeviceKeys } from '../pairing/keys';

/** Key-value storage for secrets. expo-secure-store satisfies it on device; tests pass a Map. */
export interface SecretStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export const SESSION_KEY = 'brot.session.v1';
export const DEVICE_KEY = 'brot.device-key.v1';

export const StoredSession = z.object({
  serverUrl: z.string().min(1),
  deviceId: z.string().min(1),
  deviceToken: z.string().min(1),
  deviceName: z.string().min(1),
  /** The role this phone asked for at pairing. The server enforces it; the app uses it to hide what would fail. */
  role: DeviceRole,
  pairedAt: IsoDateTime,
});
export type StoredSession = z.infer<typeof StoredSession>;

const StoredKeys = z.object({ secretKey: z.string().min(1), publicKey: z.string().min(1) });

export async function loadSession(storage: SecretStorage): Promise<StoredSession | undefined> {
  const raw = await storage.getItem(SESSION_KEY);
  if (raw === null) return undefined;
  try {
    const parsed = StoredSession.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Unreadable: treated as unpaired below.
  }
  await storage.deleteItem(SESSION_KEY);
  return undefined;
}

export async function saveSession(storage: SecretStorage, session: StoredSession): Promise<void> {
  await storage.setItem(SESSION_KEY, JSON.stringify(StoredSession.parse(session)));
}

/** Returns the device's keypair, creating and storing it on first use. */
export async function deviceKeys(storage: SecretStorage, randomBytes: (length: number) => Uint8Array): Promise<DeviceKeys> {
  const raw = await storage.getItem(DEVICE_KEY);
  if (raw !== null) {
    try {
      const parsed = StoredKeys.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // Replaced below.
    }
  }
  const keys = createDeviceKeys(randomBytes);
  await storage.setItem(DEVICE_KEY, JSON.stringify(keys));
  return keys;
}

export interface PairInput {
  serverUrl: string;
  token: string;
  deviceName: string;
  role: DeviceRole;
}

export interface PairDeps {
  storage: SecretStorage;
  randomBytes: (length: number) => Uint8Array;
  fetch?: FetchLike;
  now?: () => Date;
}

export async function pairDevice(input: PairInput, deps: PairDeps): Promise<StoredSession> {
  const keys = await deviceKeys(deps.storage, deps.randomBytes);
  const result = await completePairing(
    input.serverUrl,
    { token: input.token, deviceName: input.deviceName, publicKey: keys.publicKey, role: input.role },
    deps.fetch,
  );
  const session: StoredSession = {
    serverUrl: createClient({ baseUrl: input.serverUrl }).baseUrl,
    deviceId: result.deviceId,
    deviceToken: result.deviceToken,
    deviceName: input.deviceName,
    role: input.role,
    pairedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
  await saveSession(deps.storage, session);
  return session;
}

/**
 * Forgets the server. A full device also revokes itself on the server first; other roles cannot
 * delete devices, so their record stays until it is revoked from the computer. Local data is
 * cleared either way, and the result says whether the server side was revoked.
 */
export async function unpairDevice(
  session: StoredSession,
  deps: { storage: SecretStorage; fetch?: FetchLike },
): Promise<{ revokedOnServer: boolean }> {
  let revokedOnServer = false;
  if (session.role === 'full') {
    try {
      await createClient({ baseUrl: session.serverUrl, token: session.deviceToken, fetch: deps.fetch }).removeDevice(session.deviceId);
      revokedOnServer = true;
    } catch {
      revokedOnServer = false;
    }
  }
  await deps.storage.deleteItem(SESSION_KEY);
  await deps.storage.deleteItem(DEVICE_KEY);
  return { revokedOnServer };
}
