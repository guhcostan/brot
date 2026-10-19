import { describe, expect, it } from 'vitest';
import { connectionLabel, shortTime } from './format';

describe('format', () => {
  const now = new Date(2026, 9, 19, 15, 0);

  it('shows a clock for today', () => {
    expect(shortTime(new Date(2026, 9, 19, 14, 2).toISOString(), now)).toBe('14:02');
  });

  it('shows a date for older times and nothing for garbage', () => {
    expect(shortTime(new Date(2026, 2, 12, 9, 0).toISOString(), now)).toBe('12 Mar');
    expect(shortTime('nope', now)).toBe('');
  });

  it('describes the connection honestly', () => {
    expect(connectionLabel('live', undefined, now)).toBe('Connected');
    expect(connectionLabel('reconnecting', new Date(2026, 9, 19, 14, 2).toISOString(), now)).toBe('Oven off · last seen 14:02');
    expect(connectionLabel('unauthorized', undefined, now)).toBe('This phone was unpaired');
  });
});
