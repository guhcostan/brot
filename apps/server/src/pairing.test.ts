import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Device, PairingCompleteResponse } from '@brot/protocol';
import {
  PAIRING_FAILURE_WINDOW_MS,
  PAIRING_LOCK_MS,
  PAIRING_TTL_MS,
  PairingError,
  createPairing,
  normalizePairingAddress,
} from './pairing';
import { call, createTestContext, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

interface PairingStart {
  token: string;
  code: string;
  expiresAt: string;
  qrPayload: string;
}

type Role = 'full' | 'approver' | 'viewer';

async function startPairing(): Promise<PairingStart> {
  const res = await call(ctx.app, 'POST', '/api/pairing/start');
  expect(res.status).toBe(201);
  return (await res.json()) as PairingStart;
}

function completeBody(start: PairingStart, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { token: start.token, code: start.code, deviceName: 'Phone', publicKey: 'pk-test', role: 'full', ...overrides };
}

/** Posts to the complete route as a remote caller, optionally from a given transport address. */
async function attemptPairing(
  body: Record<string, unknown>,
  remoteAddress?: string,
): Promise<Response> {
  return ctx.remote.request(
    '/api/pairing/complete',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    remoteAddress === undefined ? undefined : { incoming: { socket: { remoteAddress } } },
  );
}

async function pairPhone(start: PairingStart, role: Role = 'full'): Promise<PairingCompleteResponse> {
  const res = await attemptPairing(completeBody(start, { role }));
  expect(res.status).toBe(201);
  return (await res.json()) as PairingCompleteResponse;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('pairing', () => {
  it('starts with a QR payload that carries the host, port, token and six-digit code', async () => {
    const start = await startPairing();
    expect(start.code).toMatch(/^\d{6}$/);
    const payload = JSON.parse(start.qrPayload) as Record<string, unknown>;
    expect(payload).toEqual({
      v: 1,
      host: ctx.services.config.host,
      port: ctx.services.config.port,
      token: start.token,
      code: start.code,
    });
    const ttl = Date.parse(start.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(PAIRING_TTL_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(PAIRING_TTL_MS);
  });

  it('refuses to start pairing from a paired remote device', async () => {
    expect((await call(ctx.remote, 'POST', '/api/pairing/start')).status).toBe(401);

    const paired = await pairPhone(await startPairing());
    const res = await call(ctx.remote, 'POST', '/api/pairing/start', undefined, bearer(paired.deviceToken));
    expect(res.status).toBe(403);
  });

  it('pairs a phone with the right code, then consumes the token', async () => {
    const start = await startPairing();
    expect((await call(ctx.remote, 'GET', '/api/bots')).status).toBe(401);

    const paired = await pairPhone(start);
    expect(paired.deviceToken.length).toBeGreaterThan(20);

    const authed = await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(paired.deviceToken));
    expect(authed.status).toBe(200);
    expect(await authed.json()).toEqual([]);

    const again = await attemptPairing(completeBody(start, { deviceName: 'Second', publicKey: 'pk-2' }));
    expect(again.status).toBe(401);

    const devices = (await (await call(ctx.app, 'GET', '/api/devices')).json()) as Device[];
    expect(devices).toEqual([expect.objectContaining({ id: paired.deviceId, name: 'Phone', role: 'full' })]);
    expect(JSON.stringify(devices)).not.toContain(paired.deviceToken);
    const device = await ctx.services.repos.devices.get(paired.deviceId);
    expect(device?.lastSeenAt).toBeDefined();
  });

  it('rejects a wrong code with 401, consumes the token, and creates no device', async () => {
    const start = await startPairing();
    const wrong = await attemptPairing(completeBody(start, { code: '000000' === start.code ? '111111' : '000000' }));
    expect(wrong.status).toBe(401);
    const body = (await wrong.json()) as { error: string };
    expect(body.error).toBe('Pairing code is invalid or expired');
    expect(JSON.stringify(body)).not.toContain(start.code);
    expect(await ctx.services.repos.devices.list()).toEqual([]);

    const retry = await attemptPairing(completeBody(start));
    expect(retry.status).toBe(401);
    expect(await ctx.services.repos.devices.list()).toEqual([]);
  });

  it('requires a well-formed six-digit code, leaving the token usable', async () => {
    const start = await startPairing();
    for (const code of [undefined, '12345', '1234567', 'abcdef', '12 456', '']) {
      const res = await attemptPairing(completeBody(start, { code }));
      expect(res.status).toBe(400);
    }
    expect(await ctx.services.repos.devices.list()).toEqual([]);
    expect((await attemptPairing(completeBody(start))).status).toBe(201);
  });

  it('rejects an expired code', async () => {
    let now = 1_000_000;
    const pairing = createPairing({ repos: ctx.services.repos, now: () => now });
    const start = pairing.start({ host: '127.0.0.1', port: 8799 });
    now += PAIRING_TTL_MS + 1;
    await expect(
      pairing.complete({ token: start.token, code: start.code, deviceName: 'Late', publicKey: 'pk', role: 'full' }),
    ).rejects.toMatchObject({ status: 401, message: 'Pairing code is invalid or expired' });
  });

  it('rejects an unknown bearer token', async () => {
    const res = await call(ctx.remote, 'GET', '/api/bots', undefined, bearer('not-a-real-token'));
    expect(res.status).toBe(401);
  });

  it('lets a viewer read but not write', async () => {
    const viewer = await pairPhone(await startPairing(), 'viewer');

    expect((await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(viewer.deviceToken))).status).toBe(200);
    const write = await call(ctx.remote, 'POST', '/api/bots', { name: 'Nope', job: 'x' }, bearer(viewer.deviceToken));
    expect(write.status).toBe(403);
    expect(await ctx.services.repos.bots.list()).toEqual([]);
  });

  it('lets an approver answer approvals but nothing else', async () => {
    const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x' })).json()) as Bot;
    const approver = await pairPhone(await startPairing(), 'approver');
    const headers = { ...bearer(approver.deviceToken), 'content-type': 'application/json' };

    const answer = await call(ctx.remote, 'POST', '/api/approvals/missing', { decision: 'deny' }, headers);
    expect(answer.status).toBe(404);

    const create = await call(ctx.remote, 'POST', '/api/bots', { name: 'Nope', job: 'x' }, headers);
    expect(create.status).toBe(403);
    const patch = await call(ctx.remote, 'PATCH', `/api/bots/${bot.id}`, { job: 'y' }, headers);
    expect(patch.status).toBe(403);
  });

  it('revoked devices lose access immediately', async () => {
    const paired = await pairPhone(await startPairing());
    expect((await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(paired.deviceToken))).status).toBe(200);

    expect((await call(ctx.app, 'DELETE', `/api/devices/${paired.deviceId}`)).status).toBe(204);
    expect((await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(paired.deviceToken))).status).toBe(401);
  });
});

describe('pairing attempt rate limit', () => {
  /** A pairing instance with an injected clock and one repo (devices are only written on success). */
  function unitPairing() {
    let now = 1_000_000;
    const pairing = createPairing({ repos: ctx.services.repos, now: () => now });
    return { pairing, advance: (ms: number) => (now += ms) };
  }

  const address = '203.0.113.9';
  const wrongCode = '000000';

  it('locks an address after five failures inside the window, and the lock expires', async () => {
    const { pairing, advance } = unitPairing();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const start = pairing.start({ host: '127.0.0.1', port: 8799 });
      await expect(
        pairing.complete(
          { token: start.token, code: wrongCode, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
          { remoteAddress: address },
        ),
      ).rejects.toMatchObject({ status: 401 });
    }

    const blocked = pairing.start({ host: '127.0.0.1', port: 8799 });
    const denied = await pairing
      .complete(
        { token: blocked.token, code: blocked.code, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
        { remoteAddress: address },
      )
      .catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(PairingError);
    expect(denied).toMatchObject({ status: 429, message: expect.stringMatching(/Try again in 10 minutes/) });

    advance(PAIRING_LOCK_MS - 1);
    await expect(
      pairing.complete(
        { token: blocked.token, code: blocked.code, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
        { remoteAddress: address },
      ),
    ).rejects.toMatchObject({ status: 429 });

    advance(2);
    const fresh = pairing.start({ host: '127.0.0.1', port: 8799 });
    await expect(
      pairing.complete(
        { token: fresh.token, code: fresh.code, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
        { remoteAddress: address },
      ),
    ).resolves.toMatchObject({ deviceToken: expect.any(String) });
  });

  it('keeps other addresses working while one is locked', async () => {
    const { pairing } = unitPairing();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const start = pairing.start({ host: '127.0.0.1', port: 8799 });
      await pairing
        .complete(
          { token: start.token, code: wrongCode, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
          { remoteAddress: address },
        )
        .catch(() => undefined);
    }
    const other = pairing.start({ host: '127.0.0.1', port: 8799 });
    await expect(
      pairing.complete(
        { token: other.token, code: other.code, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
        { remoteAddress: '198.51.100.4' },
      ),
    ).resolves.toBeDefined();
  });

  it('forgets failures older than the window', async () => {
    const { pairing, advance } = unitPairing();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const start = pairing.start({ host: '127.0.0.1', port: 8799 });
      await pairing
        .complete(
          { token: start.token, code: wrongCode, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
          { remoteAddress: address },
        )
        .catch(() => undefined);
    }
    advance(PAIRING_FAILURE_WINDOW_MS + 1);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const start = pairing.start({ host: '127.0.0.1', port: 8799 });
      await pairing
        .complete(
          { token: start.token, code: wrongCode, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
          { remoteAddress: address },
        )
        .catch(() => undefined);
    }
    const start = pairing.start({ host: '127.0.0.1', port: 8799 });
    await expect(
      pairing.complete(
        { token: start.token, code: start.code, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
        { remoteAddress: address },
      ),
    ).resolves.toBeDefined();
  });

  it('clears the counter after a successful pairing', async () => {
    const { pairing } = unitPairing();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const start = pairing.start({ host: '127.0.0.1', port: 8799 });
      await pairing
        .complete(
          { token: start.token, code: wrongCode, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
          { remoteAddress: address },
        )
        .catch(() => undefined);
    }
    const good = pairing.start({ host: '127.0.0.1', port: 8799 });
    await pairing.complete(
      { token: good.token, code: good.code, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
      { remoteAddress: address },
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const start = pairing.start({ host: '127.0.0.1', port: 8799 });
      await pairing
        .complete(
          { token: start.token, code: wrongCode, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
          { remoteAddress: address },
        )
        .catch(() => undefined);
    }
    const start = pairing.start({ host: '127.0.0.1', port: 8799 });
    await expect(
      pairing.complete(
        { token: start.token, code: start.code, deviceName: 'Phone', publicKey: 'pk', role: 'full' },
        { remoteAddress: address },
      ),
    ).resolves.toBeDefined();
  });

  it('normalizes IPv4-mapped IPv6 and host:port to the same key', () => {
    expect(normalizePairingAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizePairingAddress('127.0.0.1:8799')).toBe('127.0.0.1');
    expect(normalizePairingAddress('[::1]:8799')).toBe('::1');
    expect(normalizePairingAddress(undefined)).toBe('__unknown__');
    expect(normalizePairingAddress('')).toBe('__unknown__');
  });

  it('treats IPv4-mapped IPv6 and plain IPv4 as the same caller over HTTP', async () => {
    for (let round = 0; round < 5; round += 1) {
      const start = await startPairing();
      const wrong = await attemptPairing(completeBody(start, { code: wrongCode }), '::ffff:203.0.113.9');
      expect(wrong.status).toBe(401);
    }
    const start = await startPairing();
    const locked = await attemptPairing(completeBody(start), '203.0.113.9');
    expect(locked.status).toBe(429);
    const body = (await locked.json()) as { error: string };
    expect(body.error).toMatch(/Too many failed pairing attempts\. Try again in 10 minutes\./);
    expect(JSON.stringify(body)).not.toContain(start.code);
  });
});
