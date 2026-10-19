import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Device } from '@brot/protocol';
import { createPairing, PAIRING_TTL_MS, PairingError } from './pairing';
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

async function startPairing(): Promise<PairingStart> {
  const res = await call(ctx.app, 'POST', '/api/pairing/start');
  expect(res.status).toBe(201);
  return (await res.json()) as PairingStart;
}

async function completePairing(
  token: string,
  role: 'full' | 'approver' | 'viewer' = 'full',
): Promise<{ deviceId: string; deviceToken: string }> {
  const res = await call(ctx.remote, 'POST', '/api/pairing/complete', {
    token,
    deviceName: 'Phone',
    publicKey: 'pk-test',
    role,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { deviceId: string; deviceToken: string };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('pairing', () => {
  it('starts with a QR payload and a six-digit code, valid for two minutes', async () => {
    const start = await startPairing();
    expect(start.code).toMatch(/^\d{6}$/);
    expect(JSON.parse(start.qrPayload)).toMatchObject({ v: 1, token: start.token });
    const ttl = Date.parse(start.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(PAIRING_TTL_MS - 5000);
    expect(ttl).toBeLessThanOrEqual(PAIRING_TTL_MS);
  });

  it('refuses to start pairing from a paired remote device', async () => {
    expect((await call(ctx.remote, 'POST', '/api/pairing/start')).status).toBe(401);

    const paired = await completePairing((await startPairing()).token);
    const res = await call(ctx.remote, 'POST', '/api/pairing/start', undefined, bearer(paired.deviceToken));
    expect(res.status).toBe(403);
  });

  it('pairs a phone, authenticates it remotely, and consumes the token', async () => {
    const start = await startPairing();
    expect((await call(ctx.remote, 'GET', '/api/bots')).status).toBe(401);

    const paired = await completePairing(start.token);
    expect(paired.deviceToken.length).toBeGreaterThan(20);

    const authed = await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(paired.deviceToken));
    expect(authed.status).toBe(200);
    expect(await authed.json()).toEqual([]);

    const again = await call(ctx.remote, 'POST', '/api/pairing/complete', {
      token: start.token,
      deviceName: 'Second',
      publicKey: 'pk-2',
      role: 'full',
    });
    expect(again.status).toBe(401);

    const devices = (await (await call(ctx.app, 'GET', '/api/devices')).json()) as Device[];
    expect(devices).toEqual([expect.objectContaining({ id: paired.deviceId, name: 'Phone', role: 'full' })]);
    expect(JSON.stringify(devices)).not.toContain(paired.deviceToken);
    const device = await ctx.services.repos.devices.get(paired.deviceId);
    expect(device?.lastSeenAt).toBeDefined();
  });

  it('rejects an unknown bearer token', async () => {
    const res = await call(ctx.remote, 'GET', '/api/bots', undefined, bearer('not-a-real-token'));
    expect(res.status).toBe(401);
  });

  it('lets a viewer read but not write', async () => {
    const start = await startPairing();
    const viewer = await completePairing(start.token, 'viewer');

    expect((await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(viewer.deviceToken))).status).toBe(200);
    const write = await call(ctx.remote, 'POST', '/api/bots', { name: 'Nope', job: 'x' }, bearer(viewer.deviceToken));
    expect(write.status).toBe(403);
    expect(await ctx.services.repos.bots.list()).toEqual([]);
  });

  it('lets an approver answer approvals but nothing else', async () => {
    const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x' })).json()) as Bot;
    const start = await startPairing();
    const approver = await completePairing(start.token, 'approver');
    const headers = { ...bearer(approver.deviceToken), 'content-type': 'application/json' };

    const answer = await call(ctx.remote, 'POST', '/api/approvals/missing', { decision: 'deny' }, headers);
    expect(answer.status).toBe(404);

    const create = await call(ctx.remote, 'POST', '/api/bots', { name: 'Nope', job: 'x' }, headers);
    expect(create.status).toBe(403);
    const patch = await call(ctx.remote, 'PATCH', `/api/bots/${bot.id}`, { job: 'y' }, headers);
    expect(patch.status).toBe(403);
  });

  it('revoked devices lose access immediately', async () => {
    const start = await startPairing();
    const paired = await completePairing(start.token);
    expect((await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(paired.deviceToken))).status).toBe(200);

    expect((await call(ctx.app, 'DELETE', `/api/devices/${paired.deviceId}`)).status).toBe(204);
    expect((await call(ctx.remote, 'GET', '/api/bots', undefined, bearer(paired.deviceToken))).status).toBe(401);
  });
});

describe('pairing tokens', () => {
  it('rejects a token after it expires', async () => {
    let now = 1_000_000;
    const pairing = createPairing({ repos: ctx.services.repos, now: () => now });
    const start = pairing.start({ host: '127.0.0.1', port: 8799 });

    now += PAIRING_TTL_MS + 1;
    const attempt = pairing.complete({ token: start.token, deviceName: 'Late', publicKey: 'pk', role: 'full' });
    await expect(attempt).rejects.toBeInstanceOf(PairingError);
  });
});
