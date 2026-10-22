import { describe, expect, it } from 'vitest';
import { UsageGroup, UsageGrouping, UsageRange, UsageSummary, UsageTotals, type UsageSummary as UsageSummaryValue } from './usage';

const at = '2026-10-22T12:00:00.000Z';

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

const totals = {
  runs: 3,
  completed: 1,
  failed: 1,
  cancelled: 1,
  tokensIn: 120,
  tokensOut: 45,
  costUsd: 0.03,
};

describe('UsageRange', () => {
  it('defaults the grouping to day and leaves the bounds to the server', () => {
    expect(UsageRange.parse({})).toEqual({ group: 'day' });
    expect(UsageGrouping.options).toEqual(['day', 'bot']);
  });

  it('accepts ISO bounds, a bot filter and bot grouping', () => {
    expect(
      UsageRange.parse({ from: '2026-10-01T00:00:00.000Z', to: at, botId: 'bot_1', group: 'bot' }),
    ).toEqual({ from: '2026-10-01T00:00:00.000Z', to: at, botId: 'bot_1', group: 'bot' });
  });

  it('rejects invalid dates, an empty bot id, and an unknown grouping', () => {
    expect(() => UsageRange.parse({ from: 'yesterday' })).toThrow();
    expect(() => UsageRange.parse({ from: '2026-10-01' })).toThrow();
    expect(() => UsageRange.parse({ botId: '' })).toThrow();
    expect(() => UsageRange.parse({ group: 'week' })).toThrow();
  });
});

describe('UsageTotals', () => {
  it('round-trips totals through JSON', () => {
    expect(roundTrip(UsageTotals, totals)).toEqual(totals);
  });

  it('rejects negative and fractional counts', () => {
    expect(() => UsageTotals.parse({ ...totals, runs: -1 })).toThrow();
    expect(() => UsageTotals.parse({ ...totals, tokensIn: 1.5 })).toThrow();
    expect(() => UsageTotals.parse({ ...totals, costUsd: -0.01 })).toThrow();
    expect(() => UsageTotals.parse({ runs: 1 })).toThrow();
  });
});

describe('UsageGroup and UsageSummary', () => {
  const group = { key: '2026-10-22', totals };

  it('round-trips a day group, and a bot group with its label', () => {
    expect(roundTrip(UsageGroup, group)).toEqual(group);
    const bot = { key: 'bot_1', label: 'Ada', totals };
    expect(roundTrip(UsageGroup, bot)).toEqual(bot);
    expect(() => UsageGroup.parse({ ...group, totals: { ...totals, runs: '3' } })).toThrow();
  });

  it('round-trips a summary whose groups sort by key', () => {
    const summary: UsageSummaryValue = {
      from: '2026-09-22T12:00:00.000Z',
      to: at,
      totals,
      groups: [group, { key: 'bot_1', label: 'Ada', totals }],
    };
    expect(roundTrip(UsageSummary, summary)).toEqual(summary);
    expect(() => UsageSummary.parse({ ...summary, from: 'yesterday' })).toThrow();
    expect(() => UsageSummary.parse({ ...summary, groups: [group], totals: undefined })).toThrow();
  });
});
