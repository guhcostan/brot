import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, BrowserProfile } from '@brot/protocol';
import { createApp } from '../app';
import { call, createTestContext, type TestContext } from '../testing';
import type { HostBrowserService, HostBrowserStatus } from './types';

/** The profile a bot's host browser runs: a shared profile id, or its own id when it names none. */
function profileKeyOf(bot: Bot): string {
  return bot.browserProfileId ?? bot.id;
}

interface FakeHostBrowser extends HostBrowserService {
  /** State per profile key, so bots sharing a profile share one state the way the real service does. */
  readonly states: Map<string, HostBrowserStatus>;
  readonly statusCalls: string[];
  readonly loginCalls: string[];
  readonly closeCalls: string[];
  readonly deleteCalls: string[];
  readonly closeProfileCalls: string[];
  readonly deleteProfileDirCalls: string[];
}

function fakeHostBrowser(): FakeHostBrowser {
  const states = new Map<string, HostBrowserStatus>();
  const stateOf = (key: string): HostBrowserStatus => states.get(key) ?? { state: 'stopped' };
  const fake: FakeHostBrowser = {
    states,
    statusCalls: [],
    loginCalls: [],
    closeCalls: [],
    deleteCalls: [],
    closeProfileCalls: [],
    deleteProfileDirCalls: [],
    async browser() {
      return {};
    },
    async status(bot) {
      fake.statusCalls.push(bot.id);
      return stateOf(profileKeyOf(bot));
    },
    async openForLogin(bot) {
      fake.loginCalls.push(bot.id);
      const next: HostBrowserStatus = { state: 'login' };
      states.set(profileKeyOf(bot), next);
      return next;
    },
    async close(bot) {
      fake.closeCalls.push(bot.id);
      states.set(profileKeyOf(bot), { state: 'stopped' });
    },
    async deleteProfile(bot) {
      fake.deleteCalls.push(bot.id);
      states.set(profileKeyOf(bot), { state: 'stopped' });
    },
    async statusForProfile(profileId) {
      return stateOf(profileId);
    },
    async closeProfile(profileId) {
      fake.closeProfileCalls.push(profileId);
      states.set(profileId, { state: 'stopped' });
    },
    async deleteProfileDir(profileId) {
      fake.deleteProfileDirCalls.push(profileId);
      states.set(profileId, { state: 'stopped' });
    },
    async closeAll() {
      states.clear();
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

async function createProfile(name = 'Shared accounts'): Promise<BrowserProfile> {
  return ctx.services.repos.browserProfiles.create({ name });
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
  it('reports the host browser state and own profile of a bot that opted in', async () => {
    const res = await call(app, 'GET', `/api/bots/${browserBot.id}/browser`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'stopped', profile: { kind: 'own' } });
    expect(host.statusCalls).toEqual([browserBot.id]);

    host.states.set(browserBot.id, { state: 'running' });
    const running = await call(app, 'GET', `/api/bots/${browserBot.id}/browser`);
    expect(running.status).toBe(200);
    expect(await running.json()).toEqual({ state: 'running', profile: { kind: 'own' } });
  });

  it('names the shared profile and reports its state for every bot using it', async () => {
    const profile = await createProfile();
    const first = await createBot({ browser: true, browserProfileId: profile.id });
    const second = await createBot({ browser: true, browserProfileId: profile.id });
    const shared = { kind: 'shared', id: profile.id, name: 'Shared accounts' };

    expect(await (await call(app, 'GET', `/api/bots/${first.id}/browser`)).json()).toEqual({ state: 'stopped', profile: shared });

    await call(app, 'POST', `/api/bots/${first.id}/browser/login`);
    const bothSeeLogin = await call(app, 'GET', `/api/bots/${second.id}/browser`);
    expect(await bothSeeLogin.json()).toEqual({ state: 'login', profile: shared });

    await call(app, 'POST', `/api/bots/${second.id}/browser/close`);
    expect(host.closeCalls).toEqual([second.id]);
    expect(await (await call(app, 'GET', `/api/bots/${first.id}/browser`)).json()).toEqual({ state: 'stopped', profile: shared });
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
    expect(await res.json()).toEqual({ state: 'login', profile: { kind: 'own' } });
    expect(host.loginCalls).toEqual([browserBot.id]);

    const status = await call(app, 'GET', `/api/bots/${browserBot.id}/browser`);
    expect(await status.json()).toEqual({ state: 'login', profile: { kind: 'own' } });
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
    expect(await (await call(app, 'GET', `/api/bots/${browserBot.id}/browser`)).json()).toEqual({
      state: 'stopped',
      profile: { kind: 'own' },
    });
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

describe('browser profile routes', () => {
  it('creates, lists, renames and deletes profiles', async () => {
    const created = await call(app, 'POST', '/api/browser/profiles', { name: '  Shared accounts  ' });
    expect(created.status).toBe(201);
    const profile = (await created.json()) as BrowserProfile;
    expect(profile.name).toBe('Shared accounts');
    expect(profile.id).toEqual(expect.any(String));

    expect(await (await call(app, 'GET', '/api/browser/profiles')).json()).toEqual([profile]);

    const renamed = await call(app, 'PATCH', `/api/browser/profiles/${profile.id}`, { name: 'Team logins' });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as BrowserProfile).name).toBe('Team logins');

    const removed = await call(app, 'DELETE', `/api/browser/profiles/${profile.id}`);
    expect(removed.status).toBe(204);
    expect(host.closeProfileCalls).toEqual([profile.id]);
    expect(host.deleteProfileDirCalls).toEqual([profile.id]);
    expect(await (await call(app, 'GET', '/api/browser/profiles')).json()).toEqual([]);
  });

  it('rejects a blank, long or multi-line name with a 400 issue', async () => {
    for (const name of ['   ', 'x'.repeat(61), 'two\nlines']) {
      const res = await call(app, 'POST', '/api/browser/profiles', { name });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'Invalid request', issues: [{ path: ['name'] }] });
    }
  });

  it('answers 404 for unknown profiles on PATCH and DELETE', async () => {
    const patch = await call(app, 'PATCH', '/api/browser/profiles/nope', { name: 'Team' });
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: 'Browser profile not found' });

    const remove = await call(app, 'DELETE', '/api/browser/profiles/nope');
    expect(remove.status).toBe(404);
    expect(host.closeProfileCalls).toHaveLength(0);
    expect(host.deleteProfileDirCalls).toHaveLength(0);
  });

  it('ungroups its bots when deleted and leaves them on their own profiles', async () => {
    const profile = await createProfile();
    const first = await createBot({ browser: true, browserProfileId: profile.id });
    const second = await createBot({ browser: true, browserProfileId: profile.id });

    const removed = await call(app, 'DELETE', `/api/browser/profiles/${profile.id}`);
    expect(removed.status).toBe(204);

    for (const bot of [first, second]) {
      const after = await ctx.services.repos.bots.get(bot.id);
      expect(after?.browser).toBe(true);
      expect(after?.browserProfileId).toBeUndefined();
      expect(await (await call(app, 'GET', `/api/bots/${bot.id}/browser`)).json()).toEqual({
        state: 'stopped',
        profile: { kind: 'own' },
      });
    }
  });
});

describe('PATCH /api/bots/:id browser profile', () => {
  it('moves the bot to a shared profile and back to its own', async () => {
    const profile = await createProfile('Work');
    const patched = await call(app, 'PATCH', `/api/bots/${browserBot.id}`, { browserProfileId: profile.id });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as Bot).browserProfileId).toBe(profile.id);
    expect(await (await call(app, 'GET', `/api/bots/${browserBot.id}/browser`)).json()).toEqual({
      state: 'stopped',
      profile: { kind: 'shared', id: profile.id, name: 'Work' },
    });

    const cleared = await call(app, 'PATCH', `/api/bots/${browserBot.id}`, { browserProfileId: null });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as Bot).browserProfileId).toBeUndefined();
  });

  it('rejects an unknown profile with a 400 issue', async () => {
    const res = await call(app, 'PATCH', `/api/bots/${browserBot.id}`, { browserProfileId: 'bp_missing' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid request', issues: [{ path: ['browserProfileId'] }] });
    expect((await ctx.services.repos.bots.get(browserBot.id))?.browserProfileId).toBeUndefined();
  });

  it('accepts a shared profile on create', async () => {
    const profile = await createProfile('Work');
    const created = await call(app, 'POST', '/api/bots', {
      name: 'Ada',
      job: 'Researcher',
      browser: true,
      browserProfileId: profile.id,
    });
    expect(created.status).toBe(201);
    expect(((await created.json()) as Bot).browserProfileId).toBe(profile.id);

    const missing = await call(app, 'POST', '/api/bots', { name: 'Bo', job: 'Researcher', browserProfileId: 'bp_missing' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'Invalid request', issues: [{ path: ['browserProfileId'] }] });
  });
});

describe('DELETE /api/bots/:id', () => {
  it('closes and deletes the bot browser profile before removing the bot', async () => {
    const res = await call(app, 'DELETE', `/api/bots/${browserBot.id}`);
    expect(res.status).toBe(204);
    expect(host.deleteCalls).toEqual([browserBot.id]);
    expect((await call(app, 'GET', `/api/bots/${browserBot.id}`)).status).toBe(404);
  });

  it('answers 404 for a bot that does not exist and touches no profile', async () => {
    const res = await call(app, 'DELETE', '/api/bots/nope');
    expect(res.status).toBe(404);
    expect(host.deleteCalls).toHaveLength(0);
  });
});
