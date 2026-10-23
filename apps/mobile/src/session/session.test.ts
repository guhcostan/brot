import { describe, expect, it } from 'vitest';
import { DEVICE_KEY, SESSION_KEY, loadSession, pairDevice, unpairDevice, type StoredSession } from './session';
import { fakeFetch, headersOf, json, memoryStorage, T0 } from '../testing';

const random = (n: number) => new Uint8Array(n).fill(7);

describe('pairDevice', () => {
  it('completes pairing with the device public key and stores the session', async () => {
    const storage = memoryStorage();
    const { fetch, calls } = fakeFetch({
      'POST /api/pairing/complete': () => json({ deviceId: 'd1', deviceToken: 'tok' }, 201),
    });
    const session = await pairDevice(
      { serverUrl: 'http://mac.local:8799/', token: 'pair', code: '654321', deviceName: 'Ana’s phone', role: 'approver' },
      { storage, randomBytes: random, fetch, now: () => new Date(T0) },
    );
    expect(session).toEqual({
      serverUrl: 'http://mac.local:8799',
      deviceId: 'd1',
      deviceToken: 'tok',
      deviceName: 'Ana’s phone',
      role: 'approver',
      pairedAt: T0,
    });
    const body = JSON.parse(String(calls[0]?.init?.body));
    const keys = JSON.parse(storage.map.get(DEVICE_KEY)!);
    expect(body.publicKey).toBe(keys.publicKey);
    expect(body.code).toBe('654321');
    expect(body).not.toHaveProperty('secretKey');
    expect(await loadSession(storage)).toEqual(session);
  });

  it('stores nothing when the server refuses the token', async () => {
    const storage = memoryStorage();
    const { fetch } = fakeFetch({ 'POST /api/pairing/complete': () => json({ error: 'expired' }, 401) });
    await expect(
      pairDevice({ serverUrl: 'http://h:1', token: 'x', code: '654321', deviceName: 'P', role: 'full' }, { storage, randomBytes: random, fetch }),
    ).rejects.toMatchObject({ status: 401 });
    expect(storage.map.has(SESSION_KEY)).toBe(false);
  });
});

describe('loadSession', () => {
  it('discards a corrupt record', async () => {
    const storage = memoryStorage();
    storage.map.set(SESSION_KEY, '{"serverUrl":1');
    expect(await loadSession(storage)).toBeUndefined();
    expect(storage.map.has(SESSION_KEY)).toBe(false);
  });
});

describe('unpairDevice', () => {
  const session = (role: StoredSession['role']): StoredSession => ({
    serverUrl: 'http://h:1',
    deviceId: 'd1',
    deviceToken: 'tok',
    deviceName: 'P',
    role,
    pairedAt: T0,
  });

  it('revokes a full device on the server and clears local secrets', async () => {
    const storage = memoryStorage();
    storage.map.set(SESSION_KEY, 'x');
    storage.map.set(DEVICE_KEY, 'y');
    const { fetch, calls } = fakeFetch({ 'DELETE /api/devices/d1': () => new Response(null, { status: 204 }) });
    expect(await unpairDevice(session('full'), { storage, fetch })).toEqual({ revokedOnServer: true });
    expect(headersOf(calls[0]).Authorization).toBe('Bearer tok');
    expect(storage.map.size).toBe(0);
  });

  it('clears locally even when the server is unreachable', async () => {
    const storage = memoryStorage();
    storage.map.set(SESSION_KEY, 'x');
    const fetch = async () => {
      throw new TypeError('offline');
    };
    expect(await unpairDevice(session('full'), { storage, fetch })).toEqual({ revokedOnServer: false });
    expect(storage.map.size).toBe(0);
  });

  it('does not try to revoke for roles the server forbids from deleting devices', async () => {
    const storage = memoryStorage();
    const { fetch, calls } = fakeFetch({});
    await unpairDevice(session('approver'), { storage, fetch });
    expect(calls).toHaveLength(0);
  });
});
