import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminActivity, Bot } from '@brot/protocol';
import { hashDeviceToken } from '../auth';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function activity(query = ''): Promise<AdminActivity[]> {
  const response = await call(ctx.app, 'GET', `/api/activity${query}`);
  expect(response.status).toBe(200);
  return json<AdminActivity[]>(response);
}

async function createBot(name = 'Ada'): Promise<Bot> {
  const response = await call(ctx.app, 'POST', '/api/bots', { name, job: 'Researcher' });
  expect(response.status).toBe(201);
  return json<Bot>(response);
}

describe('GET /api/activity', () => {
  it('lists admin writes newest first with a limit', async () => {
    const bot = await createBot();
    await call(ctx.app, 'PUT', '/api/my-chrome', { endpoint: 'http://127.0.0.1:9333' });
    const preset = await json<{ id: string; name: string }>(
      await call(ctx.app, 'POST', '/api/presets', { name: 'Ops preset', job: 'Ops' }),
    );
    expect(preset.id).toBeDefined();

    const entries = await activity();
    expect(entries.map((entry) => entry.summary).slice(0, 3)).toEqual([
      'Created preset "Ops preset"',
      'Updated My Chrome endpoint',
      `Created bot "${bot.name}"`,
    ]);

    const limited = await activity('?limit=2');
    expect(limited.map((entry) => entry.summary)).toEqual(['Created preset "Ops preset"', 'Updated My Chrome endpoint']);
  });

  it('rejects an invalid limit with 400', async () => {
    for (const limit of ['0', '201', 'abc', '1.5']) {
      const response = await call(ctx.app, 'GET', `/api/activity?limit=${limit}`);
      expect(response.status).toBe(400);
    }
  });

  it('records nothing for read-only requests', async () => {
    const bot = await createBot();
    const before = await activity();
    expect(before).toHaveLength(1);

    for (const path of [
      '/api/activity',
      '/api/bots',
      `/api/bots/${bot.id}`,
      '/api/bots/missing',
      '/api/presets',
      '/api/teams',
      '/api/routines',
      '/api/mcp/servers',
      '/api/logins',
      '/api/devices',
      '/api/voice',
      '/api/transcription',
      '/api/my-chrome',
      '/api/room-decider',
    ]) {
      await call(ctx.app, 'GET', path);
    }
    expect(await activity()).toHaveLength(1);
  });
});

describe('activity recordings', () => {
  it('records bot create and delete with target and actor', async () => {
    const bot = await createBot();
    let [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'created',
      targetType: 'bot',
      targetId: bot.id,
      summary: 'Created bot "Ada"',
      actor: 'local',
    });
    expect(entry?.at).toBeDefined();

    expect((await call(ctx.app, 'DELETE', `/api/bots/${bot.id}`)).status).toBe(204);
    [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'deleted',
      targetType: 'bot',
      targetId: bot.id,
      summary: 'Deleted bot "Ada"',
    });
  });

  it('records routine creation and a run-now', async () => {
    const bot = await createBot();
    const created = await json<{ id: string; name: string }>(
      await call(ctx.app, 'POST', '/api/routines', {
        botId: bot.id,
        name: 'Morning',
        instruction: 'Check the news',
        trigger: { type: 'webhook', secret: 'shhh-secret' },
      }),
    );
    let [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'created',
      targetType: 'routine',
      targetId: created.id,
      summary: 'Created routine "Morning"',
    });
    expect(JSON.stringify(await activity())).not.toContain('shhh-secret');

    expect((await call(ctx.app, 'POST', `/api/routines/${created.id}/run`)).status).toBe(202);
    [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'ran',
      targetType: 'routine',
      targetId: created.id,
      summary: 'Ran routine "Morning"',
    });
  });

  it('records MCP server creation and deletion', async () => {
    const created = await json<{ id: string; name: string }>(
      await call(ctx.app, 'POST', '/api/mcp/servers', { name: 'files', command: 'npx', args: ['server-files'] }),
    );
    let [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'created',
      targetType: 'mcp-server',
      targetId: created.id,
      summary: 'Created MCP server "files"',
    });

    expect((await call(ctx.app, 'DELETE', `/api/mcp/servers/${created.id}`)).status).toBe(204);
    [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'deleted',
      targetType: 'mcp-server',
      targetId: created.id,
      summary: 'Deleted MCP server "files"',
    });
  });

  it('records preset creation', async () => {
    const preset = await json<{ id: string; name: string }>(
      await call(ctx.app, 'POST', '/api/presets', { name: 'Ops preset', job: 'Ops' }),
    );
    const [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'created',
      targetType: 'preset',
      targetId: preset.id,
      summary: 'Created preset "Ops preset"',
    });
  });

  it('records saved logins by name only, never their secrets', async () => {
    const created = await json<{ id: string; name: string }>(
      await call(ctx.app, 'POST', '/api/logins', {
        name: 'GitHub',
        host: 'github.com',
        username: 'ada@example.com',
        password: 'hunter2-do-not-log',
        totp: 'JBSWY3DPEHPK3PXP',
      }),
    );
    const entries = await activity();
    const [createdEntry] = entries;
    expect(createdEntry).toMatchObject({
      action: 'created',
      targetType: 'saved-login',
      targetId: created.id,
      summary: 'Added saved login "GitHub"',
    });
    const logged = JSON.stringify(entries);
    for (const secret of ['hunter2-do-not-log', 'ada@example.com', 'JBSWY3DPEHPK3PXP']) {
      expect(logged).not.toContain(secret);
    }

    expect((await call(ctx.app, 'DELETE', `/api/logins/${created.id}`)).status).toBe(204);
    const [deletedEntry] = await activity();
    expect(deletedEntry).toMatchObject({
      action: 'deleted',
      targetType: 'saved-login',
      summary: 'Deleted saved login "GitHub"',
    });
    expect(JSON.stringify(await activity())).not.toContain('hunter2-do-not-log');
  });

  it('records the settings writes', async () => {
    for (const [path, body, summary] of [
      ['/api/voice', { provider: 'system' }, 'Updated voice settings'],
      ['/api/my-chrome', { endpoint: 'http://127.0.0.1:9333' }, 'Updated My Chrome endpoint'],
      ['/api/room-decider', { model: null }, 'Updated room decider settings'],
      ['/api/transcription', { model: null }, 'Updated transcription settings'],
    ] as const) {
      const response = await call(ctx.app, 'PUT', path, body);
      expect(response.status).toBe(200);
      const [entry] = await activity();
      expect(entry).toMatchObject({ action: 'updated', targetType: 'settings', summary });
    }

    expect((await call(ctx.app, 'DELETE', '/api/my-chrome')).status).toBe(204);
    const [removed] = await activity();
    expect(removed).toMatchObject({
      action: 'deleted',
      targetType: 'settings',
      summary: 'Removed My Chrome endpoint',
    });
  });

  it('records a paired device and a device revoke', async () => {
    const started = await json<{ token: string; code: string }>(await call(ctx.app, 'POST', '/api/pairing/start'));
    expect(
      (
        await call(ctx.app, 'POST', '/api/pairing/complete', {
          token: started.token,
          code: started.code,
          deviceName: 'Pixel',
          publicKey: 'pairing-public-key',
        })
      ).status,
    ).toBe(201);
    let [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'created',
      targetType: 'device',
      summary: 'Paired device "Pixel"',
      actor: 'local',
    });

    const device = (await ctx.services.repos.devices.list()).find((item) => item.name === 'Pixel');
    if (device === undefined) throw new Error('the pairing did not create a device');
    expect((await call(ctx.app, 'DELETE', `/api/devices/${device.id}`)).status).toBe(204);
    [entry] = await activity();
    expect(entry).toMatchObject({
      action: 'revoked',
      targetType: 'device',
      targetId: device.id,
      summary: 'Revoked device "Pixel"',
    });
  });

  it('uses the paired device name as the actor for a remote request', async () => {
    const token = 'device-token-for-tests';
    const device = await ctx.services.repos.devices.create({
      name: 'iPhone',
      role: 'full',
      publicKey: 'device-public-key',
      tokenHash: hashDeviceToken(token),
    });

    const response = await call(
      ctx.remote,
      'POST',
      '/api/bots',
      { name: 'Capy', job: 'Researcher' },
      { authorization: `Bearer ${token}` },
    );
    expect(response.status).toBe(201);
    const [entry] = await activity();
    expect(entry).toMatchObject({ action: 'created', targetType: 'bot', summary: 'Created bot "Capy"', actor: 'iPhone' });
    expect(entry?.targetId).toBe((await json<Bot>(response)).id);

    // The local user still reads as local even for a request made next to a token.
    await call(ctx.app, 'DELETE', `/api/devices/${device.id}`);
    const [revoked] = await activity();
    expect(revoked).toMatchObject({ action: 'revoked', targetType: 'device', actor: 'local' });
  });
});
