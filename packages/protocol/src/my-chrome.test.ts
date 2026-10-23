import { describe, expect, it } from 'vitest';
import { Bot, BrowserMode, DEFAULT_MY_CHROME_ENDPOINT, MyChromeSettings, UpdateMyChromeSettings, myChromeEndpointIssue, myChromeEndpointIssues } from './entities';
import { CreateBot, UpdateBot } from './requests';

const baseBot = {
  id: 'bot_1',
  name: 'Ada',
  job: 'Researcher',
  instructions: '',
  engine: 'mock',
  computer: 'none' as const,
  pinned: false,
  archived: false,
  createdAt: '2026-10-22T12:00:00.000Z',
  updatedAt: '2026-10-22T12:00:00.000Z',
};

describe('Bot.browserMode', () => {
  it('is optional, so existing bots keep meaning own', () => {
    expect(Bot.parse(baseBot).browserMode).toBeUndefined();
    expect(BrowserMode.parse('own')).toBe('own');
    expect(Bot.parse({ ...baseBot, browser: true, browserMode: 'my-chrome' }).browserMode).toBe('my-chrome');
    expect(Bot.parse({ ...baseBot, browser: true, browserMode: 'own' }).browserMode).toBe('own');
    expect(() => Bot.parse({ ...baseBot, browser: true, browserMode: 'remote' })).toThrow();
  });
});

describe('CreateBot.browserMode', () => {
  it('accepts my-chrome only with browser: true', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'x', browser: true, browserMode: 'my-chrome' }).browserMode).toBe('my-chrome');
    expect(CreateBot.parse({ name: 'Ada', job: 'x' }).browserMode).toBeUndefined();
    expect(() => CreateBot.parse({ name: 'Ada', job: 'x', browserMode: 'my-chrome' })).toThrow(/browserMode/);
    expect(() => CreateBot.parse({ name: 'Ada', job: 'x', browser: false, browserMode: 'my-chrome' })).toThrow(/browserMode/);
    expect(CreateBot.parse({ name: 'Ada', job: 'x', browser: true }).browserMode).toBeUndefined();
  });
});

describe('UpdateBot.browserMode', () => {
  it('accepts a mode change, and rejects my-chrome while browsing is switched off in the same patch', () => {
    expect(UpdateBot.parse({ browserMode: 'my-chrome' }).browserMode).toBe('my-chrome');
    expect(UpdateBot.parse({ browser: true, browserMode: 'own' }).browserMode).toBe('own');
    expect(() => UpdateBot.parse({ browser: false, browserMode: 'my-chrome' })).toThrow(/browserMode/);
  });
});

describe('MyChromeSettings', () => {
  it('defaults to the loopback CDP endpoint and validates the stored shape', () => {
    expect(DEFAULT_MY_CHROME_ENDPOINT).toBe('http://127.0.0.1:9333');
    expect(DEFAULT_MY_CHROME_ENDPOINT).not.toContain(':9222');
    expect(MyChromeSettings.parse({ endpoint: DEFAULT_MY_CHROME_ENDPOINT })).toEqual({ endpoint: DEFAULT_MY_CHROME_ENDPOINT });
    expect(MyChromeSettings.parse({ endpoint: 'http://127.0.0.1:9223', updatedAt: '2026-10-22T12:00:00.000Z' }).updatedAt).toBe(
      '2026-10-22T12:00:00.000Z',
    );
    expect(UpdateMyChromeSettings.parse({ endpoint: DEFAULT_MY_CHROME_ENDPOINT })).toEqual({ endpoint: DEFAULT_MY_CHROME_ENDPOINT });
  });

  it('accepts only loopback http(s) endpoints without credentials, path, query or fragment', () => {
    for (const endpoint of [
      'http://127.0.0.1:9333',
      'https://127.0.0.1:9333',
      'http://localhost:9333',
      'http://[::1]:9333',
      'http://127.0.0.1',
    ]) {
      expect(myChromeEndpointIssue(endpoint), endpoint).toBeUndefined();
    }
    const cases: Array<[string, RegExp]> = [
      ['ftp://127.0.0.1:9333', /http or https/],
      ['http://example.com:9333', /loopback/],
      ['http://10.0.0.5:9333', /loopback/],
      ['http://user:pass@127.0.0.1:9333', /credentials/],
      ['http://127.0.0.1:9333/?x=1', /query or fragment/],
      ['http://127.0.0.1:9333/#tab', /query or fragment/],
      ['http://127.0.0.1:9333/devtools', /path/],
      ['not a url', /valid URL/],
    ];
    for (const [endpoint, message] of cases) {
      expect(myChromeEndpointIssue(endpoint), endpoint).toMatch(message);
      expect(() => UpdateMyChromeSettings.parse({ endpoint })).not.toThrow(); // shape only; the route reports the issue
    }
    expect(myChromeEndpointIssues('http://example.com:9333')).toEqual([
      { path: ['endpoint'], message: expect.stringMatching(/loopback/) },
    ]);
    expect(myChromeEndpointIssues('http://example.com:9333', ['settings', 'endpoint'])[0]?.path).toEqual(['settings', 'endpoint']);
  });
});
