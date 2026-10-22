import { describe, expect, it } from 'vitest';
import { UsageRange, UsageSummary, type Run } from '@brot/protocol';
import {
  DEFAULT_USAGE_DAYS,
  aggregateUsage,
  emptyUsageTotals,
  resolveUsageRange,
  summarizeUsage,
  usageDayKey,
} from './';

const now = new Date('2026-10-22T12:00:00.000Z');

function run(id: string, startedAt: string, overrides: Partial<Run> = {}): Run {
  const base: Run = {
    id,
    threadId: 't1',
    botId: 'bot_ada',
    status: 'completed',
    engine: 'mock',
    startedAt,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };
  return { ...base, ...overrides };
}

const bots = new Map([
  ['bot_ada', 'Ada'],
  ['bot_grace', 'Grace'],
]);

describe('resolveUsageRange', () => {
  it('defaults to the last 30 days and day grouping', () => {
    expect(resolveUsageRange(UsageRange.parse({}), now)).toEqual({
      ok: true,
      range: { from: '2026-09-22T12:00:00.000Z', to: '2026-10-22T12:00:00.000Z', group: 'day' },
    });
    expect(DEFAULT_USAGE_DAYS).toBe(30);
  });

  it('counts the default window back from an explicit to, and keeps the bot and grouping', () => {
    const resolved = resolveUsageRange(
      UsageRange.parse({ to: '2026-10-01T00:00:00Z', botId: 'bot_ada', group: 'bot' }),
      now,
    );
    expect(resolved).toEqual({
      ok: true,
      range: {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
        botId: 'bot_ada',
        group: 'bot',
      },
    });
  });

  it('rejects a from after the to, but accepts an empty range', () => {
    expect(
      resolveUsageRange(
        UsageRange.parse({ from: '2026-10-03T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }),
        now,
      ),
    ).toEqual({ ok: false, path: ['from'], message: 'from must not be after to' });
    expect(
      resolveUsageRange(
        UsageRange.parse({ from: '2026-10-02T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }),
        now,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe('aggregateUsage', () => {
  const runs = [
    run('run_1', '2026-10-01T23:30:00.000Z', { tokensIn: 10, tokensOut: 5, costUsd: 0.1 }),
    run('run_2', '2026-10-02T00:30:00.000Z', { status: 'failed', tokensIn: 20, tokensOut: 10, costUsd: 0.2 }),
    run('run_3', '2026-10-02T12:00:00.000Z', { status: 'running', tokensIn: 5, tokensOut: 1, costUsd: 0.05 }),
    run('run_4', '2026-10-02T20:00:00.000Z', {
      status: 'cancelled',
      botId: 'bot_grace',
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0.01,
    }),
  ];

  it('keeps terminal status counts and sums tokens and cost over every run', () => {
    const { totals } = aggregateUsage(runs, 'day', bots);
    expect(totals).toMatchObject({ runs: 4, completed: 1, failed: 1, cancelled: 1, tokensIn: 36, tokensOut: 17 });
    expect(totals.costUsd).toBeCloseTo(0.36, 10);
  });

  it('groups by UTC day, across midnight, oldest first', () => {
    const { groups } = aggregateUsage(runs, 'day', bots);
    expect(groups.map((group) => group.key)).toEqual(['2026-10-01', '2026-10-02']);
    expect(groups[0]).toMatchObject({
      key: '2026-10-01',
      totals: { runs: 1, completed: 1, failed: 0, cancelled: 0, tokensIn: 10, tokensOut: 5 },
    });
    expect(groups[0]?.label).toBeUndefined();
    expect(groups[0]?.totals.costUsd).toBeCloseTo(0.1, 10);
    expect(groups[1]).toMatchObject({
      key: '2026-10-02',
      totals: { runs: 3, completed: 0, failed: 1, cancelled: 1, tokensIn: 26, tokensOut: 12 },
    });
    expect(groups[1]?.totals.costUsd).toBeCloseTo(0.26, 10);
    expect(usageDayKey('2026-10-01T23:59:59.999Z')).toBe('2026-10-01');
    expect(usageDayKey('2026-10-02T00:00:00.000Z')).toBe('2026-10-02');
  });

  it('groups by bot, sorted by id, with the bot name as label', () => {
    const { groups } = aggregateUsage(runs, 'bot', bots);
    expect(groups.map((group) => group.key)).toEqual(['bot_ada', 'bot_grace']);
    expect(groups[0]?.label).toBe('Ada');
    expect(groups[0]?.totals).toMatchObject({ runs: 3, completed: 1, failed: 1, cancelled: 0, tokensIn: 35, tokensOut: 16 });
    expect(groups[1]?.label).toBe('Grace');
    expect(groups[1]?.totals.runs).toBe(1);
  });

  it('falls back to the bot id when the name is unknown', () => {
    const { groups } = aggregateUsage([run('run_5', '2026-10-02T00:00:00.000Z', { botId: 'bot_gone' })], 'bot', bots);
    expect(groups[0]).toMatchObject({ key: 'bot_gone', label: 'bot_gone' });
  });

  it('returns zero totals and no groups for an empty range, without sharing a totals object', () => {
    const { totals, groups } = aggregateUsage([], 'day', bots);
    expect(totals).toEqual(emptyUsageTotals());
    expect(groups).toEqual([]);
    expect(emptyUsageTotals()).not.toBe(emptyUsageTotals());
  });
});

describe('summarizeUsage', () => {
  it('returns the resolved range with the aggregate, in the protocol shape', () => {
    const range = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-03T00:00:00.000Z', group: 'day' as const };
    const summary = summarizeUsage(
      [
        run('run_1', '2026-10-01T12:00:00.000Z', { tokensIn: 3, tokensOut: 4, costUsd: 0.02 }),
        run('run_2', '2026-10-02T12:00:00.000Z', { status: 'failed', botId: 'bot_grace' }),
      ],
      range,
      bots,
    );
    expect(summary).toMatchObject({ from: range.from, to: range.to });
    expect(summary.totals).toMatchObject({ runs: 2, completed: 1, failed: 1, tokensIn: 3, tokensOut: 4 });
    expect(summary.groups.map((group) => group.key)).toEqual(['2026-10-01', '2026-10-02']);
    expect(UsageSummary.parse(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });
});
