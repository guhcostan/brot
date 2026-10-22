import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_VIEWPORT,
  FIELD_PAGE_SOURCE,
  SNAPSHOT_PAGE_SOURCE,
  inputProblem,
  parseRef,
  resolveOpenUrl,
  sensitiveReason,
  toPlaywrightKey,
  type FieldInfo,
} from './driver';
import { botFor } from './test-helpers';

function field(overrides: Partial<FieldInfo>): FieldInfo {
  return { tag: 'input', type: 'text', autocomplete: '', name: '', label: '', ...overrides };
}

describe('toPlaywrightKey', () => {
  it('maps xdotool names and modifiers to Playwright keys', () => {
    expect(toPlaywrightKey('Return')).toBe('Enter');
    expect(toPlaywrightKey('enter')).toBe('Enter');
    expect(toPlaywrightKey('esc')).toBe('Escape');
    expect(toPlaywrightKey('PageDown')).toBe('PageDown');
    expect(toPlaywrightKey('ctrl+l')).toBe('Control+l');
    expect(toPlaywrightKey('cmd+shift+Tab')).toBe('Meta+Shift+Tab');
  });

  it('refuses an unknown modifier', () => {
    expect(() => toPlaywrightKey('hyper+l')).toThrow(/unknown modifier/);
  });
});

describe('parseRef', () => {
  it('accepts refs from the latest snapshot', () => {
    expect(parseRef(12)).toBe('12');
    expect(parseRef('123456')).toBe('123456');
  });

  it('refuses anything that is not a snapshot ref', () => {
    expect(() => parseRef('abc')).toThrow(/ref must be a number/);
    expect(() => parseRef('1234567')).toThrow(/ref must be a number/);
    expect(() => parseRef(undefined)).toThrow(/ref must be a number/);
  });
});

describe('sensitiveReason', () => {
  it('flags password, one-time code and card fields', () => {
    expect(sensitiveReason(field({ type: 'password' }))).toBe('a password field');
    expect(sensitiveReason(field({ autocomplete: 'current-password' }))).toBe('a password, card or one-time code field');
    expect(sensitiveReason(field({ autocomplete: 'one-time-code' }))).toBe('a password, card or one-time code field');
    expect(sensitiveReason(field({ autocomplete: 'cc-number' }))).toBe('a password, card or one-time code field');
    expect(sensitiveReason(field({ name: 'card number' }))).toBe('a password or card field');
    expect(sensitiveReason(field({ label: 'Credit card' }))).toBe('a password or card field');
  });

  it('leaves ordinary fields alone', () => {
    expect(sensitiveReason(field({ type: 'search', autocomplete: 'off', name: 'q', label: 'Search' }))).toBeUndefined();
    expect(sensitiveReason(field({ type: 'email', name: 'email' }))).toBeUndefined();
    expect(sensitiveReason(undefined)).toBeUndefined();
  });
});

describe('resolveOpenUrl', () => {
  const bot = botFor('bot_1', ['example.com', '*.example.org']);

  it('accepts http, https and about:blank', () => {
    expect(resolveOpenUrl(bot, 'https://example.com').hostname).toBe('example.com');
    expect(resolveOpenUrl(bot, 'http://api.example.org/page').hostname).toBe('api.example.org');
    expect(resolveOpenUrl(bot, 'about:blank').protocol).toBe('about:');
  });

  it('refuses every scheme other than http and https', () => {
    expect(() => resolveOpenUrl(bot, 'file:///etc/passwd')).toThrow(/only http and https/);
    expect(() => resolveOpenUrl(bot, 'javascript:alert(1)')).toThrow(/only http and https/);
  });

  it('refuses a host outside the policy, including loopback', () => {
    expect(() => resolveOpenUrl(bot, 'https://www.google.com')).toThrow(
      /www\.google\.com is not on this bot's egress allowlist/,
    );
    expect(() => resolveOpenUrl(bot, 'http://127.0.0.1:8080')).toThrow(/not on this bot's egress allowlist/);
  });

  it('refuses everything for a deny-all bot and a malformed URL', () => {
    expect(() => resolveOpenUrl(botFor('bot_2'), 'https://example.com')).toThrow(/not on this bot's egress allowlist/);
    expect(() => resolveOpenUrl(bot, 'not a url')).toThrow();
  });
});

describe('page source strings', () => {
  it('are plain JavaScript with no transpiler helper calls', () => {
    for (const source of [SNAPSHOT_PAGE_SOURCE, FIELD_PAGE_SOURCE]) {
      // Playwright ships a serialized function's source to the page; a `__name(...)` call from esbuild's
      // keepNames broke snapshot and field in the live server. Strings are not transformed, so guard them.
      expect(source).not.toContain('__name');
      expect(() => new Script(`(${source})`)).not.toThrow();
    }
  });
});

describe('browser input validation', () => {
  it('uses the fixed 1280x800 viewport and accepts coordinates inside it', () => {
    expect(BROWSER_VIEWPORT).toEqual({ width: 1280, height: 800 });
    expect(inputProblem({ type: 'move', x: 0, y: 0 })).toBeUndefined();
    expect(inputProblem({ type: 'click', x: 1279, y: 799, button: 'left', double: true })).toBeUndefined();
    expect(inputProblem({ type: 'scroll', x: 640, y: 400, dy: -3 })).toBeUndefined();
    expect(inputProblem({ type: 'type', text: 'hello' })).toBeUndefined();
    expect(inputProblem({ type: 'key', key: 'ctrl+l' })).toBeUndefined();
  });

  it('refuses coordinates outside the viewport or not finite', () => {
    expect(inputProblem({ type: 'move', x: 1280, y: 10 })).toMatch(/outside the 1280x800 browser viewport/);
    expect(inputProblem({ type: 'click', x: 10, y: 800, button: 'left', double: false })).toMatch(/outside/);
    expect(inputProblem({ type: 'move', x: -1, y: 0 })).toMatch(/outside/);
    expect(inputProblem({ type: 'scroll', x: Number.NaN, y: 0, dy: 1 })).toMatch(/finite/);
  });

  it('refuses an unknown key modifier before it reaches the page', () => {
    expect(inputProblem({ type: 'key', key: 'hyper+l' })).toMatch(/unknown modifier/);
  });
});
