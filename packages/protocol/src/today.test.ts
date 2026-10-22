import { describe, expect, it } from 'vitest';
import {
  TodayBot,
  TodayHighlight,
  TodayQuery,
  TodayRoutines,
  TodaySummary,
  TodayTotals,
  type TodaySummary as TodaySummaryValue,
} from './today';

const at = '2026-10-22T12:00:00.000Z';

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

const totals = { runs: 4, completed: 2, failed: 1, cancelled: 1, tokensIn: 120, tokensOut: 45, costUsd: 0.3 };

describe('TodayQuery', () => {
  it('keeps every field optional', () => {
    expect(TodayQuery.parse({})).toEqual({});
    expect(TodayQuery.parse({ from: at, to: '2026-10-23T00:00:00.000Z', tz: 'America/Sao_Paulo' })).toEqual({
      from: at,
      to: '2026-10-23T00:00:00.000Z',
      tz: 'America/Sao_Paulo',
    });
  });

  it('rejects invalid dates and an empty timezone', () => {
    expect(() => TodayQuery.parse({ from: 'yesterday' })).toThrow();
    expect(() => TodayQuery.parse({ to: '2026-10-22' })).toThrow();
    expect(() => TodayQuery.parse({ tz: '' })).toThrow();
  });
});

describe('TodayTotals and TodayBot', () => {
  it('round-trips totals through JSON and rejects bad counts', () => {
    expect(roundTrip(TodayTotals, totals)).toEqual(totals);
    expect(() => TodayTotals.parse({ ...totals, runs: -1 })).toThrow();
    expect(() => TodayTotals.parse({ ...totals, tokensOut: 1.5 })).toThrow();
    expect(() => TodayTotals.parse({ runs: 1 })).toThrow();
  });

  it('round-trips a per-bot share', () => {
    const bot = { botId: 'bot_1', name: 'Ada', runs: 3, completed: 2, failed: 1, tokensIn: 10, tokensOut: 4, costUsd: 0.12 };
    expect(roundTrip(TodayBot, bot)).toEqual(bot);
    expect(() => TodayBot.parse({ ...bot, name: '' })).toThrow();
  });
});

describe('TodayRoutines and TodayHighlight', () => {
  it('counts routine statuses as non-negative integers', () => {
    const routines = { completed: 2, failed: 1, skipped: 1, running: 3 };
    expect(TodayRoutines.parse(routines)).toEqual(routines);
    expect(() => TodayRoutines.parse({ ...routines, running: -1 })).toThrow();
    expect(() => TodayRoutines.parse({ completed: 1 })).toThrow();
  });

  it('round-trips a highlight and rejects an empty text or bad timestamp', () => {
    const highlight = { botId: 'bot_1', botName: 'Ada', threadId: 't1', text: 'Shipped the report.', at };
    expect(roundTrip(TodayHighlight, highlight)).toEqual(highlight);
    expect(() => TodayHighlight.parse({ ...highlight, text: '' })).toThrow();
    expect(() => TodayHighlight.parse({ ...highlight, at: 'yesterday' })).toThrow();
  });
});

describe('TodaySummary', () => {
  const summary: TodaySummaryValue = {
    from: '2026-10-22T03:00:00.000Z',
    to: at,
    totals,
    byBot: [
      { botId: 'bot_1', name: 'Ada', runs: 2, completed: 1, failed: 1, tokensIn: 30, tokensOut: 15, costUsd: 0.2 },
      { botId: 'bot_2', name: 'Grace', runs: 2, completed: 1, failed: 0, tokensIn: 90, tokensOut: 30, costUsd: 0.1 },
    ],
    routines: { completed: 2, failed: 1, skipped: 1, running: 3 },
    pendingApprovals: 2,
    highlights: [{ botId: 'bot_1', botName: 'Ada', threadId: 't1', text: 'Done.', at }],
  };

  it('round-trips a summary through JSON', () => {
    expect(roundTrip(TodaySummary, summary)).toEqual(summary);
  });

  it('rejects missing and negative fields', () => {
    expect(() => TodaySummary.parse({ ...summary, pendingApprovals: -1 })).toThrow();
    expect(() => TodaySummary.parse({ ...summary, byBot: undefined })).toThrow();
    expect(() => TodaySummary.parse({ ...summary, from: 'today' })).toThrow();
  });
});
