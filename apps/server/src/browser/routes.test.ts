import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from '@brot/protocol';
import { createApp } from '../app';
import { call, createTestContext, type TestContext } from '../testing';
import type { HostBrowserService, HostBrowserStatus } from './types';

interface FakeHostBrowser extends HostBrowserService {
  state: HostBrowserStatus;
  readonly statusCalls: string[];
  readonly loginCalls: string[];
  readonly closeCalls: string[];
}

function fakeHostBrowser(): FakeHostBrowser {
  const fake: FakeHostBrowser = {
    state: { state: 'stopped' },
    statusCalls: [],
    loginCalls: [],
    closeCalls: [],
    async browser() {
      return {};
    },
    async status(bot) {
      fake.statusCalls.push(bot.id);
      return fake.state;
    },
    async openForLogin(bot) {
      fake.loginCalls.push(bot.id);
      fake.state = { state: 'login' };
      return fake.state;
    },
    async close(bot) {
      fake.closeCalls.push(bot.id);
      fake.state = { state: 'stopped' };
    },
    async closeAll() {
      fake.state = { state: 'stopped' };
    },
  };
  return fake;
}

let ctx: TestContext;
let host: FakeHostBrowser;
let app: ReturnType<typeof createApp>;
let browserBot: Bot;
let plainBot: Bot;
let desktopBot: Bot;

async function createBot(overrides: Record<string, unknown> = {}): Promise<Bot> {
  return ctx.services.repos.bots.create({ name: 'Ada', job: 'Researcher', engine: 'mock', ...overrides });
}

beforeEach(async () => {
  ctx = await createTestContext();
  host = fakeHostBrowser();
  app = createApp({
    ...ctx.services,
    config: { host: '127.0.0.1', port: 8799, mode: 'server' },
    trustLoopback: true,
    browser: host,
  });
  browserBot = await createBot({ browser: true });
  plainBot = await createBot();
  desktopBot = await createBot({ browser: true, computer: 'sandbox', desktop: true });
});

afterEach(async () => {
  await ctx.close();
});

describe('the bot browser flag', () => {
  it('persists browser on create, defaults it to false, and lets a PATCH turn it off', async () => {
    const created = await call(app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', browser: true });
    expect(created.status).toBe(201);
    const bot = (await created.json()) as Bot;
    expect(bot.browser).toBe(true);

    const plain = await call(app, 'POST', '/api/bots', { name: 'Bo', job: 'Researcher' });
    expect(((await plain.json()) as Bot).browser).toBeUndefined();

    const off = await call(app, 'PATCH', `/api/bots/${bot.id}`, { browser: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as Bot).browser).toBeUndefined();
    expect((await call(app, 'GET', `/api/bots/${bot.id}/browser`)).status).toBe(409);
  });
});

describe('GET /api/bots/:id/browser', () => {
  it('reports the host browser state of a bot that opted in', async () => {
    const res = await call(app, 'GET', `/api/bots/${browserBot.id}/browser`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'stopped' });
    expect(host.statusCalls).toEqual([browserBot.id]);

    host.state = { state: 'running' };
    const running = await call(app, 'GET', `/api/bots/${browserBot.id}/browser`);
    expect(running.status).toBe(200);
    expect(await running.json()).toEqual({ state: 'running' });
  });

  it('answers 404 for an unknown bot', async () => {
    const res = await call(app, 'GET', '/api/bots/nope/browser');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Bot not found' });
    expect(host.statusCalls).toHaveLength(0);
  });

  it('answers 409 for a bot with no browser', async () => {
    const res = await call(app, 'GET', `/api/bots/${plainBot.id}/browser`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This bot has no browser' });
    expect(host.statusCalls).toHaveLength(0);
  });
});

describe('POST /api/bots/:id/browser/login', () => {
  it('opens the headed login window and answers 202 with the login state', async () => {
    const res = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/login`);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ state: 'login' });
    expect(host.loginCalls).toEqual([browserBot.id]);

    const status = await call(app, 'GET', `/api/bots/${browserBot.id}/browser`);
    expect(await status.json()).toEqual({ state: 'login' });
  });

  it('answers 404 for an unknown bot', async () => {
    const res = await call(app, 'POST', '/api/bots/nope/browser/login');
    expect(res.status).toBe(404);
    expect(host.loginCalls).toHaveLength(0);
  });

  it('answers 409 for a bot with no browser', async () => {
    const res = await call(app, 'POST', `/api/bots/${plainBot.id}/browser/login`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This bot has no browser' });
    expect(host.loginCalls).toHaveLength(0);
  });

  it('answers 409 for a desktop sandbox bot, whose computer already has a browser', async () => {
    const res = await call(app, 'POST', `/api/bots/${desktopBot.id}/browser/login`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This bot already has a browser in its desktop' });
    expect(host.loginCalls).toHaveLength(0);
  });

  it('requires JSON content type like every state-changing request', async () => {
    const res = await app.request(`/api/bots/${browserBot.id}/browser/login`, { method: 'POST' });
    expect(res.status).toBe(415);
    expect(host.loginCalls).toHaveLength(0);
  });
});

describe('POST /api/bots/:id/browser/close', () => {
  it('closes the browser and answers 204, idempotently', async () => {
    await call(app, 'POST', `/api/bots/${browserBot.id}/browser/login`);
    const first = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/close`);
    expect(first.status).toBe(204);
    expect(host.closeCalls).toEqual([browserBot.id]);

    const second = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/close`);
    expect(second.status).toBe(204);
    expect(host.closeCalls).toEqual([browserBot.id, browserBot.id]);
    expect((await (await call(app, 'GET', `/api/bots/${browserBot.id}/browser`)).json())).toEqual({ state: 'stopped' });
  });

  it('answers 404 for an unknown bot', async () => {
    const res = await call(app, 'POST', '/api/bots/nope/browser/close');
    expect(res.status).toBe(404);
    expect(host.closeCalls).toHaveLength(0);
  });

  it('answers 409 for a bot with no browser', async () => {
    const res = await call(app, 'POST', `/api/bots/${plainBot.id}/browser/close`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This bot has no browser' });
    expect(host.closeCalls).toHaveLength(0);
  });
});
