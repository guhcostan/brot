import { describe, expect, it } from 'vitest';
import { customUsageWindow, formatShortDate, formatTokenPair, formatUsageDay, localMidnightIso, todayWindow, usageWindow } from './insights';
import { downloadFileUrl } from './download';

describe('insights windows', () => {
  const now = new Date('2026-10-22T15:30:00.000Z');

  it('lets the server compute local midnight for the Today preset', () => {
    const window = todayWindow('today', now);
    expect(window.from).toBeUndefined();
    expect(window.to).toBeUndefined();
    expect(window.tz).toBeTruthy();
  });

  it('counts back whole days for the presets', () => {
    expect(todayWindow('7d', now).from).toBe('2026-10-15T15:30:00.000Z');
    expect(todayWindow('30d', now).from).toBe('2026-09-22T15:30:00.000Z');
    expect(usageWindow('7d', now)).toEqual({ from: '2026-10-15T15:30:00.000Z' });
    expect(usageWindow('90d', now).from).toBe('2026-07-24T15:30:00.000Z');
    expect(usageWindow('today', now).from).toBe(localMidnightIso(now));
  });

  it('keeps an explicit custom range, covering both selected days', () => {
    expect(customUsageWindow('2026-10-01', '2026-10-19')).toEqual({
      from: new Date('2026-10-01T00:00:00').toISOString(),
      to: new Date('2026-10-20T00:00:00').toISOString(),
    });
    expect(todayWindow('custom', now, { from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b' });
    expect(usageWindow('custom', now, { from: 'a', to: 'b' })).toEqual({ from: 'a', to: 'b' });
  });

  it('rejects an incomplete or backwards custom range', () => {
    expect(customUsageWindow('', '2026-10-19')).toBeUndefined();
    expect(customUsageWindow('2026-10-19', '')).toBeUndefined();
    expect(customUsageWindow('2026-10-20', '2026-10-19')).toBeUndefined();
    expect(customUsageWindow('not-a-date', '2026-10-19')).toBeUndefined();
  });
});

describe('insights formatting', () => {
  it('formats token pairs with grouped digits', () => {
    expect(formatTokenPair(184_320, 52_880)).toBe('184,320 / 52,880');
    expect(formatTokenPair(0, 0)).toBe('0 / 0');
  });

  it('formats usage day keys and window bounds', () => {
    expect(formatUsageDay('2026-10-19')).toMatch(/Oct/);
    expect(formatShortDate('2026-10-19T12:00:00.000Z')).toMatch(/Oct/);
    expect(formatUsageDay('nope')).toBe('nope');
    expect(formatShortDate('nope')).toBe('nope');
  });

  it('cannot save a URL during SSR', () => {
    expect(downloadFileUrl('brot-usage.csv', '/api/usage/export.csv')).toBe(false);
  });
});
