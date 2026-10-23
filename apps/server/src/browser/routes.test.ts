import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, BrowserProfile, BrowserTakeover, ComputerInput } from '@brot/protocol';
import { createApp } from '../app';
import { hashDeviceToken } from '../auth';
import { call, createTestContext, type TestContext } from '../testing';
import { BrowserError } from './service';
import type { HostBrowserService, HostBrowserStatus } from './types';

/** A tiny JPEG: enough for the screen route to pass bytes through unchanged. */
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

/** The profile a bot's host browser runs: a shared profile id, or its own id when it names none. */
function profileKeyOf(bot: Bot): string {
  return bot.browserProfileId ?? bot.id;
}

interface FakeHostBrowser extends HostBrowserService {
  /** State per profile key, so bots sharing a profile share one state the way the real service does. */
  readonly states: Map<string, HostBrowserStatus>;
  readonly takeovers: Map<string, BrowserTakeover>;
  readonly statusCalls: string[];
  readonly loginCalls: string[];
  readonly closeCalls: string[];
  readonly deleteCalls: string[];
  readonly closeProfileCalls: string[];
  readonly deleteProfileDirCalls: string[];
  readonly screenCalls: string[];
  readonly takeoverCalls: string[];
  readonly inputCalls: Array<{ botId: string; input: ComputerInput }>;
  screenBytes: Uint8Array;
  screenError?: BrowserError;
  inputError?: BrowserError;
}

function fakeHostBrowser(): FakeHostBrowser {
  const states = new Map<string, HostBrowserStatus>();
  const stateOf = (key: string): HostBrowserStatus => states.get(key) ?? { state: 'stopped' };
  const takeovers = new Map<string, BrowserTakeover>();
  const fake: FakeHostBrowser = {
    states,
    takeovers,
    statusCalls: [],
    loginCalls: [],
    closeCalls: [],
    deleteCalls: [],
    closeProfileCalls: [],
    deleteProfileDirCalls: [],
    screenCalls: [],
    takeoverCalls: [],
    inputCalls: [],
    screenBytes: FAKE_JPEG,
    async browser() {
      return {};
    },
    async probeMyChrome() {
      return { endpoint: 'http://127.0.0.1:9333', available: false, reason: 'not part of this fake' };
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
    async browserScreen(bot) {
      fake.screenCalls.push(bot.id);
      if (fake.screenError !== undefined) throw fake.screenError;
      return fake.screenBytes;
    },
    async browserTakeover(bot) {
      fake.takeoverCalls.push(bot.id);
      return takeovers.get(profileKeyOf(bot)) ?? { active: false };
    },
    async setBrowserTakeover(bot, change) {
      const takeover: BrowserTakeover = {
        active: change.active,
        ...(change.active ? { since: new Date().toISOString() } : {}),
        ...(change.reason === undefined ? {} : { reason: change.reason }),
      };
      takeovers.set(profileKeyOf(bot), takeover);
      return takeover;
    },
    async pageHost() {
      return null;
    },
    async fillLogin() {
      return undefined;
    },
    async browserInput(bot, input) {
      fake.inputCalls.push({ botId: bot.id, input });
      if (fake.inputError !== undefined) throw fake.inputError;
      if (takeovers.get(profileKeyOf(bot))?.active !== true) throw new BrowserError(409, 'No takeover is active.');
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
      takeovers.clear();
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

describe('GET /api/bots/:id/browser/screen', () => {
  it('returns the frame as no-store JPEG bytes', async () => {
    const res = await call(app, 'GET', `/api/bots/${browserBot.id}/browser/screen`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(FAKE_JPEG));
    expect(host.screenCalls).toEqual([browserBot.id]);
  });

  it('answers 404 for an unknown bot and 409 for a bot without a browser', async () => {
    expect((await call(app, 'GET', '/api/bots/nope/browser/screen')).status).toBe(404);
    expect((await call(app, 'GET', `/api/bots/${plainBot.id}/browser/screen`)).status).toBe(409);
    expect(host.screenCalls).toHaveLength(0);
  });

  it('passes a service conflict through when the browser cannot start', async () => {
    host.screenError = new BrowserError(409, 'The browser could not start.');
    const res = await call(app, 'GET', `/api/bots/${browserBot.id}/browser/screen`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'The browser could not start.' });
  });

  it('is readable by a viewer device, since viewers may watch', async () => {
    const token = randomBytes(24).toString('base64url');
    await ctx.services.repos.devices.create({ name: 'Phone', role: 'viewer', publicKey: 'test-public-key', tokenHash: hashDeviceToken(token) });
    const res = await call(ctx.remote, 'GET', `/api/bots/${browserBot.id}/browser/screen`, undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });
});

describe('browser takeover', () => {
  it('reports no takeover, takes control with a reason, and hands it back', async () => {
    const before = await call(app, 'GET', `/api/bots/${browserBot.id}/browser/takeover`);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ active: false });

    const taken = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/takeover`, { active: true, reason: 'Sign in to X' });
    expect(taken.status).toBe(200);
    const takeover = (await taken.json()) as BrowserTakeover;
    expect(takeover).toMatchObject({ active: true, reason: 'Sign in to X' });
    expect(Number.isNaN(new Date(takeover.since ?? '').getTime())).toBe(false);

    expect(await (await call(app, 'GET', `/api/bots/${browserBot.id}/browser/takeover`)).json()).toMatchObject({ active: true });

    const handedBack = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/takeover`, { active: false });
    expect(await handedBack.json()).toEqual({ active: false });
  });

  it('reports one takeover for every bot sharing the profile', async () => {
    const profile = await createProfile();
    const first = await createBot({ browser: true, browserProfileId: profile.id });
    const second = await createBot({ browser: true, browserProfileId: profile.id });

    await call(app, 'POST', `/api/bots/${first.id}/browser/takeover`, { active: true, reason: 'Sign in' });
    const seenBySecond = await call(app, 'GET', `/api/bots/${second.id}/browser/takeover`);
    expect(await seenBySecond.json()).toMatchObject({ active: true, reason: 'Sign in' });

    await call(app, 'POST', `/api/bots/${second.id}/browser/takeover`, { active: false });
    expect(await (await call(app, 'GET', `/api/bots/${first.id}/browser/takeover`)).json()).toEqual({ active: false });
  });

  it('rejects a takeover body without a boolean active', async () => {
    const res = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/takeover`, { active: 'yes' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid request' });
  });

  it('answers 404 for an unknown bot and 409 for a bot without a browser', async () => {
    expect((await call(app, 'GET', '/api/bots/nope/browser/takeover')).status).toBe(404);
    expect((await call(app, 'POST', '/api/bots/nope/browser/takeover', { active: true })).status).toBe(404);
    expect((await call(app, 'POST', `/api/bots/${plainBot.id}/browser/takeover`, { active: true })).status).toBe(409);
    expect(host.takeoverCalls).toHaveLength(0);
  });
});

describe('POST /api/bots/:id/browser/input', () => {
  it('accepts input while a takeover is active', async () => {
    await call(app, 'POST', `/api/bots/${browserBot.id}/browser/takeover`, { active: true });
    const res = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/input`, { type: 'click', x: 100, y: 120 });
    expect(res.status).toBe(204);
    expect(host.inputCalls).toEqual([
      { botId: browserBot.id, input: { type: 'click', x: 100, y: 120, button: 'left', double: false } },
    ]);
  });

  it('refuses input until the person has taken over', async () => {
    const res = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/input`, { type: 'move', x: 1, y: 1 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'No takeover is active.' });
    expect(host.inputCalls).toHaveLength(1);
  });

  it('rejects an input event that does not match the contract', async () => {
    await call(app, 'POST', `/api/bots/${browserBot.id}/browser/takeover`, { active: true });
    const res = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/input`, { type: 'key', key: 'bad key;rm' });
    expect(res.status).toBe(400);
    expect(host.inputCalls).toHaveLength(0);
  });

  it('passes through the out-of-viewport 400 and the sign-in 409', async () => {
    await call(app, 'POST', `/api/bots/${browserBot.id}/browser/takeover`, { active: true });

    host.inputError = new BrowserError(400, 'input is outside the 1280x800 browser viewport');
    const outside = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/input`, { type: 'move', x: 5000, y: 20 });
    expect(outside.status).toBe(400);
    expect(await outside.json()).toEqual({ error: 'input is outside the 1280x800 browser viewport' });

    host.inputError = new BrowserError(409, 'The browser is in its sign-in window; type and click in that window.');
    const signingIn = await call(app, 'POST', `/api/bots/${browserBot.id}/browser/input`, { type: 'key', key: 'Tab' });
    expect(signingIn.status).toBe(409);
    expect(await signingIn.json()).toEqual({ error: 'The browser is in its sign-in window; type and click in that window.' });
  });

  it('answers 404 for an unknown bot and 409 for a bot without a browser', async () => {
    expect((await call(app, 'POST', '/api/bots/nope/browser/input', { type: 'move', x: 1, y: 1 })).status).toBe(404);
    expect((await call(app, 'POST', `/api/bots/${plainBot.id}/browser/input`, { type: 'move', x: 1, y: 1 })).status).toBe(409);
    expect(host.inputCalls).toHaveLength(0);
  });

  it('lets a viewer watch but not drive: takeover and input need a full device', async () => {
    const token = randomBytes(24).toString('base64url');
    await ctx.services.repos.devices.create({ name: 'Phone', role: 'viewer', publicKey: 'test-public-key', tokenHash: hashDeviceToken(token) });
    const auth = { authorization: `Bearer ${token}` };
    expect((await call(ctx.remote, 'GET', `/api/bots/${browserBot.id}/browser/takeover`, undefined, auth)).status).toBe(200);
    expect((await call(ctx.remote, 'POST', `/api/bots/${browserBot.id}/browser/takeover`, { active: true }, auth)).status).toBe(403);
    expect(
      (await call(ctx.remote, 'POST', `/api/bots/${browserBot.id}/browser/input`, { type: 'move', x: 1, y: 1 }, auth)).status,
    ).toBe(403);
  });
});
