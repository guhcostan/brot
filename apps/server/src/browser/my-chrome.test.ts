import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Bot } from '@brot/protocol';
import type { Browser } from 'playwright-core';
import { BrowserError, createHostBrowserService } from './service';
import type { SettingsStore } from './types';

/** Settings rows in memory: enough for the endpoint and the per-bot modes. */
class FakeSettings implements SettingsStore {
  readonly rows = new Map<string, unknown>();
  async get<T>(key: string, schema: { parse(value: unknown): T }): Promise<T | undefined> {
    const value = this.rows.get(key);
    if (value === undefined) return undefined;
    try {
      return schema.parse(value);
    } catch {
      return undefined;
    }
  }
}

/** A fake page: records navigation and answers the title/url the driver reads. */
class FakePage {
  currentUrl = 'about:blank';
  readonly visits: string[] = [];
  setDefaultTimeout(): void {}
  async goto(url: string): Promise<void> {
    this.visits.push(url);
    this.currentUrl = url;
  }
  url(): string {
    return this.currentUrl;
  }
  async title(): Promise<string> {
    return 'Example Domain';
  }
  async setViewportSize(): Promise<void> {
    throw new Error('My Chrome must not resize the person page');
  }
  async waitForLoadState(): Promise<void> {}
  async evaluate(): Promise<{ text: string; truncated: boolean }> {
    return { text: 'Example Domain', truncated: false };
  }
}

class FakeContext {
  constructor(readonly page: FakePage) {}
  pages(): FakePage[] {
    return [this.page];
  }
  async newPage(): Promise<FakePage> {
    return this.page;
  }
}

class FakeCdpBrowser {
  connected = true;
  closeCalls = 0;
  constructor(private readonly userAgent = 'Mozilla/5.0 (Macintosh) Chrome/142.0.0.0 Safari/537.36') {}
  readonly page = new FakePage();
  readonly context = new FakeContext(this.page);
  contexts(): FakeContext[] {
    return [this.context];
  }
  async newContext(): Promise<FakeContext> {
    return this.context;
  }
  isConnected(): boolean {
    return this.connected;
  }
  async close(): Promise<void> {
    this.closeCalls += 1;
    this.connected = false;
  }
  on(): this {
    return this;
  }
  version(): string {
    return 'Chrome/142.0.7444.59';
  }
  async newBrowserCDPSession(): Promise<{ send(method: string): Promise<Record<string, unknown>>; detach(): Promise<void> }> {
    return {
      send: async (method) =>
        method === 'Browser.getVersion'
          ? { product: 'Chrome/142.0.7444.59', userAgent: this.userAgent }
          : {},
      detach: async () => undefined,
    };
  }
}

function bot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: 'bot_1',
    name: 'Ada',
    job: 'Researcher',
    instructions: '',
    engine: 'dsh',
    computer: 'none',
    browser: true,
    browserMode: 'my-chrome',
    // A deny-all policy proves My Chrome is not filtered by the bot's egress.
    egress: { mode: 'deny', allow: [] },
    pinned: false,
    archived: false,
    createdAt: '2026-10-22T12:00:00.000Z',
    updatedAt: '2026-10-22T12:00:00.000Z',
    ...overrides,
  };
}

async function serviceWith(options: { fail?: boolean; settings?: FakeSettings } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'brot-mychrome-'));
  const settings = options.settings ?? new FakeSettings();
  const browsers: FakeCdpBrowser[] = [];
  const connections: string[] = [];
  const service = createHostBrowserService({
    home,
    settings,
    connectOverCDP: async (endpoint) => {
      connections.push(endpoint);
      if (options.fail === true) throw new Error('connect ECONNREFUSED');
      const browser = new FakeCdpBrowser();
      browsers.push(browser);
      return browser as unknown as Browser;
    },
  });
  const current = (): FakeCdpBrowser => {
    const browser = browsers.at(-1);
    if (browser === undefined) throw new Error('the service never connected');
    return browser;
  };
  return { service, browser: { get closeCalls() { return browsers.reduce((sum, item) => sum + item.closeCalls, 0); }, get page() { return current().page; }, get contexts() { return current().contexts.bind(current()); } }, browsers, connections, settings, home };
}

const UNREACHABLE =
  'Could not reach Chrome at http://127.0.0.1:9333. Point My Chrome at your own Chrome started with --user-data-dir="$HOME/.brot-my-chrome" --remote-debugging-port=9333. A browser already used by another automation app must not be used.';
const BROWSER = {
  version: 'Chrome/142.0.7444.59',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/142.0.0.0 Safari/537.36',
};

describe('My Chrome attach', () => {
  it('connects to the person\'s Chrome, reuses its first context, and keeps the handle on release', async () => {
    const { service, browser, connections } = await serviceWith();
    const first = await service.browser(bot(), 'open', { url: 'https://example.com/' });
    expect(first).toEqual({ title: 'Example Domain', url: 'https://example.com/' });
    expect(connections).toEqual(['http://127.0.0.1:9333']);
    expect(browser.page.visits).toEqual(['https://example.com/']);
    expect(browser.closeCalls).toBe(0);

    // A second command reuses our connection and the person's tab: no new connection, no new page, no close.
    await service.browser(bot(), 'snapshot', {});
    expect(connections).toHaveLength(1);
    expect(browser.contexts()).toHaveLength(1);
    expect(browser.closeCalls).toBe(0);
  });

  it('reports connected/stopped with the endpoint, and detaches on close without killing the browser', async () => {
    const { service, browser } = await serviceWith();
    const status = await service.status(bot());
    expect(status).toEqual({ state: 'running', mode: 'my-chrome', endpoint: 'http://127.0.0.1:9333' });

    await service.close(bot());
    expect(browser.closeCalls).toBe(1); // our handle only
    expect((await service.status(bot())).state).toBe('running'); // a status reconnects
  });

  it('surfaces the start-Chrome instruction when the endpoint refuses', async () => {
    const { service } = await serviceWith({ fail: true });
    const error = await service.browser(bot(), 'open', { url: 'https://example.com/' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BrowserError);
    expect(error).toMatchObject({ status: 409, message: UNREACHABLE });
    expect(await service.status(bot())).toEqual({
      state: 'stopped',
      mode: 'my-chrome',
      endpoint: 'http://127.0.0.1:9333',
    });
    const probe = await service.probeMyChrome();
    expect(probe).toEqual({ endpoint: 'http://127.0.0.1:9333', available: false, reason: UNREACHABLE });
  });

  it('probes by connecting and disconnecting, leaving no connection open', async () => {
    const { service, browser, connections } = await serviceWith();
    expect(await service.probeMyChrome()).toEqual({
      endpoint: 'http://127.0.0.1:9333',
      available: true,
      browser: BROWSER,
      automation: false,
    });
    expect(connections).toHaveLength(1);
    expect(browser.closeCalls).toBe(1);
  });

  it('reports what it reached when the endpoint is an automation browser', async () => {
    const home = await mkdtemp(join(tmpdir(), 'brot-mychrome-'));
    const service = createHostBrowserService({
      home,
      settings: new FakeSettings(),
      connectOverCDP: async () =>
        new FakeCdpBrowser('Mozilla/5.0 HeadlessChrome/142.0.7444.59 Safari/537.36') as unknown as Browser,
    });
    const probe = await service.probeMyChrome();
    expect(probe.available).toBe(true);
    expect(probe.automation).toBe(true);
    expect(probe.browser?.userAgent).toContain('HeadlessChrome');
  });

  it('uses the stored endpoint and reads the stored bot mode', async () => {
    const settings = new FakeSettings();
    settings.rows.set('my-chrome', { endpoint: 'http://127.0.0.1:9333' });
    settings.rows.set('bot-browser-mode:bot_2', 'my-chrome');
    const { service, connections } = await serviceWith({ settings });
    // The bot row has no browserMode field; the stored setting decides.
    await service.browser(bot({ id: 'bot_2', browserMode: undefined }), 'open', { url: 'https://example.com/' });
    expect(connections).toEqual(['http://127.0.0.1:9333']);
    await service.browser(bot({ id: 'bot_2', browserMode: undefined }), 'snapshot', {});
    expect(connections).toHaveLength(1);
  });

  it('refuses the profile sign-in window for My Chrome, and never creates a profile directory', async () => {
    const { service, home } = await serviceWith();
    const refusal = await service.openForLogin(bot()).catch((caught: unknown) => caught);
    expect(refusal).toMatchObject({
      status: 409,
      message: 'My Chrome is already signed in; switch the bot to its own profile to sign in from Brot.',
    });
    await service.deleteProfile(bot());
    await expect(access(join(home, 'browser-profiles'))).rejects.toThrow();
  });
});
