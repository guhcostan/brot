import { describe, expect, it } from 'vitest';
import { formatBytes, formatRelativeTime } from './format';

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-19T12:00:00.000Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it('uses the relative phrasing of the app language', () => {
    expect(formatRelativeTime(ago(5), now)).toBe('5 seconds ago');
    expect(formatRelativeTime(ago(120), now)).toBe('2 minutes ago');
    expect(formatRelativeTime(ago(3 * 3600), now)).toBe('3 hours ago');
    expect(formatRelativeTime(ago(3 * 86_400), now)).toBe('3 days ago');
    expect(formatRelativeTime('not a date', now)).toBe('');
  });
});

describe('formatBytes', () => {
  it('scales bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
