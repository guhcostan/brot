import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';
import { MY_CHROME_SETTINGS_KEY, botBrowserModeKey as modeKey } from './my-chrome';
import { BrowserError } from './service';
import type { HostBrowserStatus as Status, HostBrowserService as Service } from './types';

const DEFAULT = 'http://127.0.0.1:9333';
const BROWSER = { version: 'Chrome/142.0.7444.59', userAgent: 'Mozilla/5.0 (Macintosh) Chrome/142.0.0.0 Safari/537.36' };

interface FakeBrowser extends Service {
  probeCalls: string[];
  state: Status;
  loginError?: BrowserError;
}

function fakeBrowser(): FakeBrowser {
  const fake: FakeBrowser = {
    probeCalls: [],
    state: { state: 'stopped' },
    async probeMyChrome() {
      fake.probeCalls.push('probe');
      return { endpoint: DEFAULT, available: true, browser: BROWSER, automation: false };
    },
    async status() {
      return fake.state;
    },
    async openForLogin() {
      if (fake.loginError !== undefined) throw fake.loginError;
      fake.state = { state: 'login' };
      return fake.state;
    },
    async browser() {
      return {};
    },
    async close() {
      fake.state = { state: 'stopped' };
    },
    async deleteProfile() {},
    async browserScreen() {
      return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    },
    async browserTakeover() {
      return { active: false };
    },
    async setBrowserTakeover() {
      return { active: false };
    },
    async browserInput() {},
    async pageHost() {
      return null;
    },
    async fillLogin() {},
    async statusForProfile() {
      return fake.state;
    },
    async closeProfile() {
      fake.state = { state: 'stopped' };
    },
    async deleteProfileDir() {},
    async closeAll() {}
  } as unknown as FakeBrowser;
  return fake;
}

let ctx: TestContext;
let browser: FakeBrowser;

beforeEach(async () => {
  browser = fakeBrowser();
  ctx = await createTestContext({ browser: browser as unknown as Service });
});

afterEach(async () => {
  await ctx.close();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function makeBot(overrides: Record<string, unknown> = {}): Promise<Bot> {
  const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x', ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as Bot;
}

describe('GET/PUT /api/my-chrome', () => {
  it('returns the default endpoint, the probe result and the attach hint', async () => {
    const res = await call(ctx.app, 'GET', '/api/my-chrome');
    expect(res.status).toBe(200);
    const body = await json<{ settings: { endpoint: string }; available: boolean; browser: typeof BROWSER; hint: string }>(res);
    expect(body).toMatchObject({ settings: { endpoint: DEFAULT }, available: true, browser: BROWSER, automation: false });
    expect(body.hint).toContain('--user-data-dir="$HOME/.brot-my-chrome" --remote-debugging-port=9333');
    expect(body.hint).toContain('must not be used');
    expect(browser.probeCalls).toEqual(['probe']);
  });

  it('saves a loopback endpoint, reports it with updatedAt, and probes the saved one', async () => {
    const saved = await call(ctx.app, 'PUT', '/api/my-chrome', { endpoint: 'http://127.0.0.1:9444' });
    expect(saved.status).toBe(200);
    const settings = await json<{ endpoint: string; updatedAt?: string }>(saved);
    expect(settings).toMatchObject({ endpoint: 'http://127.0.0.1:9444', updatedAt: expect.any(String) });
    expect(await ctx.services.repos.settings.get(MY_CHROME_SETTINGS_KEY, (await import('@brot/protocol')).MyChromeSettings)).toEqual(settings);

    const read = await json<{ settings: { endpoint: string }; available: boolean }>(await call(ctx.app, 'GET', '/api/my-chrome'));
    expect(read.settings.endpoint).toBe('http://127.0.0.1:9444');
    expect(read.available).toBe(true);
    expect(browser.probeCalls).toHaveLength(1);
  });

  it('rejects non-loopback endpoints and leaves the setting alone', async () => {
    for (const endpoint of ['http://example.com:9333', 'http://user:pass@127.0.0.1:9333', 'ftp://127.0.0.1:9333', 'not a url']) {
      const res = await call(ctx.app, 'PUT', '/api/my-chrome', { endpoint });
      expect(res.status, endpoint).toBe(400);
      const body = await json<{ issues: Array<{ path: string[] }> }>(res);
      expect(body.issues[0]?.path).toEqual(['endpoint']);
    }
    expect(await ctx.services.repos.settings.get(MY_CHROME_SETTINGS_KEY, (await import('@brot/protocol')).MyChromeSettings)).toBeUndefined();
  });

  it('does not connect when the stored endpoint is invalid, and says why', async () => {
    const { MyChromeSettings } = await import('@brot/protocol');
    await ctx.services.repos.settings.set(MY_CHROME_SETTINGS_KEY, MyChromeSettings.parse({ endpoint: 'http://example.com:9333' }));
    const body = await json<{ available: boolean; reason: string }>(await call(ctx.app, 'GET', '/api/my-chrome'));
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/loopback/);
    expect(browser.probeCalls).toEqual([]);
  });

  it('clears the stored endpoint back to the default', async () => {
    await call(ctx.app, 'PUT', '/api/my-chrome', { endpoint: 'http://127.0.0.1:9444' });
    expect((await call(ctx.app, 'DELETE', '/api/my-chrome')).status).toBe(204);
    const body = await json<{ settings: { endpoint: string } }>(await call(ctx.app, 'GET', '/api/my-chrome'));
    expect(body.settings.endpoint).toBe(DEFAULT);
  });

  it('needs a paired device for a remote caller', async () => {
    expect((await ctx.remote.request('/api/my-chrome')).status).toBe(401);
    expect((await ctx.remote.request('/api/my-chrome', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: DEFAULT }) })).status).toBe(401);
  });
});

describe('bot browserMode', () => {
  it('round-trips through create, list, get and the bot mode setting', async () => {
    const bot = await makeBot({ browser: true, browserMode: 'my-chrome' });
    expect(bot.browserMode).toBe('my-chrome');
    expect(await ctx.services.repos.settings.get(modeKey(bot.id), (await import('@brot/protocol')).BrowserMode)).toBe('my-chrome');

    const listed = (await json<Bot[]>(await call(ctx.app, 'GET', '/api/bots'))) as Bot[];
    expect(listed.find((candidate) => candidate.id === bot.id)?.browserMode).toBe('my-chrome');
    const one = await json<Bot>(await call(ctx.app, 'GET', `/api/bots/${bot.id}`));
    expect(one.browserMode).toBe('my-chrome');
  });

  it('rejects my-chrome without browser: true', async () => {
    const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x', browserMode: 'my-chrome' });
    expect(res.status).toBe(400);
    const body = await json<{ issues: Array<{ path: string[]; message: string }> }>(res);
    expect(body.issues[0]).toMatchObject({ path: ['browserMode'], message: 'my-chrome needs browser: true' });
  });

  it('validates a patch against the bot it would leave behind', async () => {
    const bot = await makeBot({ browser: true });
    const switched = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { browserMode: 'my-chrome' });
    expect(switched.status).toBe(200);
    expect(await json<Bot>(switched)).toMatchObject({ browser: true, browserMode: 'my-chrome' });

    const off = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { browser: false });
    expect(off.status).toBe(400);
    expect((await json<{ issues: Array<{ path: string[] }> }>(off)).issues[0]?.path).toEqual(['browserMode']);

    const own = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { browserMode: 'own' });
    expect(own.status).toBe(200);
    expect((await json<Bot>(own)).browserMode).toBeUndefined();
    expect(await ctx.services.repos.settings.get(modeKey(bot.id), (await import('@brot/protocol')).BrowserMode)).toBeUndefined();
  });

  it('clears the stored mode when the bot is deleted', async () => {
    const bot = await makeBot({ browser: true, browserMode: 'my-chrome' });
    expect(await ctx.services.repos.settings.get(modeKey(bot.id), (await import('@brot/protocol')).BrowserMode)).toBe('my-chrome');
    expect((await call(ctx.app, 'DELETE', `/api/bots/${bot.id}`)).status).toBe(204);
    expect(await ctx.services.repos.settings.get(modeKey(bot.id), (await import('@brot/protocol')).BrowserMode)).toBeUndefined();
  });

  it('reports the My Chrome endpoint in the browser status route', async () => {
    const bot = await makeBot({ browser: true, browserMode: 'my-chrome' });
    browser.state = { state: 'running', mode: 'my-chrome', endpoint: 'http://127.0.0.1:9444' };
    const status = await json<Record<string, unknown>>(await call(ctx.app, 'GET', `/api/bots/${bot.id}/browser`));
    expect(status).toMatchObject({ state: 'running', mode: 'my-chrome', endpoint: 'http://127.0.0.1:9444' });
  });

  it('refuses the profile sign-in route for My Chrome with 409', async () => {
    const bot = await makeBot({ browser: true, browserMode: 'my-chrome' });
    browser.loginError = new BrowserError(
      409,
      'My Chrome is already signed in; switch the bot to its own profile to sign in from Brot.',
    );
    const res = await call(ctx.app, 'POST', `/api/bots/${bot.id}/browser/login`);
    expect(res.status).toBe(409);
    expect(await json<{ error: string }>(res)).toEqual({
      error: 'My Chrome is already signed in; switch the bot to its own profile to sign in from Brot.',
    });
  });
});
