import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, CanonicalEvent, Thread } from '@brot/protocol';
import { hashDeviceToken } from '../auth';
import { call, createTestContext, recordEvents, type TestContext } from '../testing';
import { fakeProvider, fakeRunner, FAKE_JPEG, type FakeRunner } from './test-helpers';

let ctx: TestContext;
let runner: FakeRunner;
let bot: Bot;
let plain: Bot;
let thread: Thread;

beforeEach(async () => {
  runner = fakeRunner();
  ctx = await createTestContext({
    computers: { sandbox: fakeProvider() },
    desktop: { runner, takeoverWaitMs: 40, takeoverPollMs: 5 },
  });
  const { repos } = ctx.services;
  bot = await repos.bots.create({
    name: 'Ada',
    job: 'Researcher',
    engine: 'mock',
    instructions: '',
    computer: 'sandbox',
    desktop: true,
    egress: { mode: 'allowlist', allow: ['example.com'] },
  });
  plain = await repos.bots.create({
    name: 'Bo',
    job: 'Helper',
    engine: 'mock',
    instructions: '',
    computer: 'sandbox',
    egress: { mode: 'deny', allow: [] },
  });
  thread = await repos.threads.create(bot.id, { title: 'Chat' });
});

afterEach(async () => {
  await ctx.close();
});

describe('GET /api/bots/:id/computer', () => {
  it('reports the desktop, its size and no takeover before anything starts', async () => {
    const res = await call(ctx.app, 'GET', `/api/bots/${bot.id}/computer`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'none', desktop: true, width: 1280, height: 800, takeover: null });
  });

  it('answers 404 for an unknown bot', async () => {
    expect((await call(ctx.app, 'GET', '/api/bots/bot_missing/computer')).status).toBe(404);
  });

  it('is readable without a full device, since viewers may look', async () => {
    const res = await call(ctx.remote, 'GET', `/api/bots/${bot.id}/computer`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/bots/:id/computer/start', () => {
  it('starts the computer and the desktop and reports ready', async () => {
    const res = await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/start`);
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe('ready');
    expect(runner.calls.some((recorded) => recorded.argv[0] === 'brot-desktop-start')).toBe(true);
  });
});

describe('GET /api/bots/:id/computer/screen', () => {
  it('returns the frame as no-store JPEG', async () => {
    await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/start`);
    const res = await call(ctx.app, 'GET', `/api/bots/${bot.id}/computer/screen`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(FAKE_JPEG));
  });

  it('answers 404 for a bot without a desktop', async () => {
    expect((await call(ctx.app, 'GET', `/api/bots/${plain.id}/computer/screen`)).status).toBe(404);
  });

  it('answers 409 when the computer is not running', async () => {
    expect((await call(ctx.app, 'GET', `/api/bots/${bot.id}/computer/screen`)).status).toBe(409);
  });
});

describe('input and takeover', () => {
  it('refuses input with 409 until the person has taken over', async () => {
    const res = await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/input`, { type: 'key', key: 'Return' });
    expect(res.status).toBe(409);
  });

  it('starts a takeover, emits computer.takeover on the latest thread, and then accepts input', async () => {
    const events = recordEvents(ctx.services.bus, thread.id);
    await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/start`);
    const taken = await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/takeover`, { active: true, reason: 'Sign in' });
    expect(taken.status).toBe(200);
    expect(await taken.json()).toMatchObject({ botId: bot.id, active: true, requestedBy: 'user', reason: 'Sign in' });

    const input = await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/input`, { type: 'click', x: 40, y: 50 });
    expect(input.status).toBe(204);
    expect(runner.calls.at(-1)?.argv[0]).toBe('xdotool');

    const emitted = events.list.filter((event): event is Extract<CanonicalEvent, { type: 'computer.takeover' }> => event.type === 'computer.takeover');
    expect(emitted.at(-1)?.takeover.active).toBe(true);
    events.stop();
  });

  it('rejects an input event that does not match the contract', async () => {
    await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/takeover`, { active: true });
    const res = await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/input`, { type: 'key', key: 'bad key;rm' });
    expect(res.status).toBe(400);
  });

  it('rejects a takeover body without a boolean active', async () => {
    const res = await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/takeover`, { active: 'yes' });
    expect(res.status).toBe(400);
  });

  it('returns the takeover in the state view while it is active', async () => {
    await call(ctx.app, 'POST', `/api/bots/${bot.id}/computer/takeover`, { active: true });
    const state = await (await call(ctx.app, 'GET', `/api/bots/${bot.id}/computer`)).json();
    expect(state.takeover).toMatchObject({ active: true });
  });

  it('answers 404 for input to a bot without a desktop', async () => {
    const res = await call(ctx.app, 'POST', `/api/bots/${plain.id}/computer/input`, { type: 'move', x: 1, y: 1 });
    expect(res.status).toBe(404);
  });

  it('lets a viewer read but not drive: input needs a full device', async () => {
    const token = randomBytes(24).toString('base64url');
    await ctx.services.repos.devices.create({ name: 'Phone', role: 'viewer', publicKey: 'test-public-key', tokenHash: hashDeviceToken(token) });
    const auth = { authorization: `Bearer ${token}` };
    expect((await call(ctx.remote, 'GET', `/api/bots/${bot.id}/computer`, undefined, auth)).status).toBe(200);
    expect((await call(ctx.remote, 'POST', `/api/bots/${bot.id}/computer/takeover`, { active: true }, auth)).status).toBe(403);
    expect((await call(ctx.remote, 'POST', `/api/bots/${bot.id}/computer/input`, { type: 'move', x: 1, y: 1 }, auth)).status).toBe(403);
  });
});

describe('GET /api/providers', () => {
  it('lists each provider, with configured true only when the vault holds its secret', async () => {
    const before = (await (await call(ctx.app, 'GET', '/api/providers')).json()) as Array<{
      id: string;
      api: string;
      configured: boolean;
      secretName: string;
    }>;
    const opencode = before.find((provider) => provider.id === 'opencode-go');
    expect(opencode).toMatchObject({ api: 'openai-completions', configured: false, secretName: 'opencode-go' });

    await ctx.services.vault.set('opencode-go', 'sk-test-not-a-real-key');
    const after = (await (await call(ctx.app, 'GET', '/api/providers')).json()) as Array<{ id: string; configured: boolean; models: unknown[] }>;
    expect(after.find((provider) => provider.id === 'opencode-go')).toMatchObject({ configured: true });
    expect(JSON.stringify(after)).not.toContain('sk-test-not-a-real-key');
  });
});
