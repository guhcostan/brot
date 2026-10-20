import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTheme, setTheme } from './theme';

function stub(throws = false) {
  const store = new Map<string, string>();
  const attrs = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => {
      if (throws) throw new Error('blocked');
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (throws) throw new Error('blocked');
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      removeAttribute: (name: string) => attrs.delete(name),
    },
  });
  return { store, attrs };
}

afterEach(() => vi.unstubAllGlobals());

describe('theme', () => {
  it('defaults to system', () => {
    stub();
    expect(getTheme()).toBe('system');
  });

  it('persists a choice and sets data-theme', () => {
    const { attrs } = stub();
    setTheme('dark');
    expect(getTheme()).toBe('dark');
    expect(attrs.get('data-theme')).toBe('dark');
    setTheme('system');
    expect(getTheme()).toBe('system');
    expect(attrs.has('data-theme')).toBe(false);
  });

  it('still applies the theme when storage throws', () => {
    const { attrs } = stub(true);
    setTheme('light');
    expect(attrs.get('data-theme')).toBe('light');
    expect(getTheme()).toBe('system');
  });
});
