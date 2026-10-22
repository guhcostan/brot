import { describe, expect, it } from 'vitest';
import type { RoutineRun, Run, TodayQuery } from '@brot/protocol';
import {
  countRoutineRuns,
  emptyTodayTotals,
  isValidTimeZone,
  localMidnight,
  resolveTodayRange,
  serverTimeZone,
  summarizeRuns,
} from './';

function run(id: string, botId: string, status: Run['status'], startedAt: string, overrides: Partial<Run> = {}): Run {
  const base: Run = {
    id,
    threadId: `thread_${id}`,
    botId,
    status,
    engine: 'mock',
    startedAt,
    endedAt: status === 'running' || status === 'waiting_approval' ? undefined : startedAt,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };
  return { ...base, ...overrides };
}

function routineRun(status: RoutineRun['status'], startedAt = '2026-10-22T10:00:00.000Z'): RoutineRun {
  return {
    id: `rr_${status}_${startedAt}`,
    routineId: 'rt1',
    botId: 'bot_1',
    threadId: 't1',
    trigger: 'schedule',
    status,
    startedAt,
    createdAt: startedAt,
  };
}

const bots = new Map([
  ['bot_ada', 'Ada'],
  ['bot_grace', 'Grace'],
]);

describe('serverTimeZone and isValidTimeZone', () => {
  it('reports a real IANA zone for the server', () => {
    const zone = serverTimeZone();
    expect(zone.length).toBeGreaterThan(0);
    expect(zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it('accepts IANA names and rejects anything else', () => {
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('+05:30')).toBe(false);
  });
});

describe('localMidnight', () => {
  it('uses UTC midnight in UTC', () => {
    expect(localMidnight(new Date('2026-10-22T17:45:12.000Z'), 'UTC').toISOString()).toBe('2026-10-22T00:00:00.000Z');
  });

  it('uses the zone offset for the local calendar day', () => {
    expect(localMidnight(new Date('2026-10-22T17:45:00.000Z'), 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-22T03:00:00.000Z',
    );
    // 01:00Z is still the previous local day in Sao Paulo (22:00), so midnight is that day's, not the next.
    expect(localMidnight(new Date('2026-10-23T01:00:00.000Z'), 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-22T03:00:00.000Z',
    );
    // 17:45Z is already the next day in Tokyo (02:45), so midnight is 15:00Z the day before.
    expect(localMidnight(new Date('2026-10-22T17:45:00.000Z'), 'Asia/Tokyo').toISOString()).toBe(
      '2026-10-22T15:00:00.000Z',
    );
  });

  it('follows daylight saving time', () => {
    expect(localMidnight(new Date('2026-07-15T12:00:00.000Z'), 'America/New_York').toISOString()).toBe(
      '2026-07-15T04:00:00.000Z',
    );
    expect(localMidnight(new Date('2026-01-15T12:00:00.000Z'), 'America/New_York').toISOString()).toBe(
      '2026-01-15T05:00:00.000Z',
    );
  });
});

describe('resolveTodayRange', () => {
  const now = new Date('2026-10-22T17:45:00.000Z');

  function resolve(query: TodayQuery, defaultTimeZone = 'UTC') {
    return resolveTodayRange(query, now, defaultTimeZone);
  }

  it('defaults to the local midnight of now', () => {
    expect(resolve({ tz: 'UTC' })).toEqual({
      ok: true,
      range: { from: '2026-10-22T00:00:00.000Z', to: '2026-10-22T17:45:00.000Z', tz: 'UTC' },
    });
  });

  it('defaults the timezone to the server zone', () => {
    expect(resolve({}, 'America/Sao_Paulo')).toEqual({
      ok: true,
      range: { from: '2026-10-22T03:00:00.000Z', to: '2026-10-22T17:45:00.000Z', tz: 'America/Sao_Paulo' },
    });
  });

  it('computes the midnight of an explicit to in the given zone', () => {
    expect(resolve({ to: '2026-07-15T12:00:00.000Z', tz: 'America/New_York' })).toEqual({
      ok: true,
      range: { from: '2026-07-15T04:00:00.000Z', to: '2026-07-15T12:00:00.000Z', tz: 'America/New_York' },
    });
  });

  it('normalizes explicit bounds and accepts an empty range', () => {
    expect(resolve({ from: '2026-10-21T00:00:00Z', to: '2026-10-22T00:00:00Z', tz: 'UTC' })).toEqual({
      ok: true,
      range: { from: '2026-10-21T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z', tz: 'UTC' },
    });
    expect(resolve({ from: '2026-10-22T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' })).toMatchObject({ ok: true });
  });

  it('rejects an invalid timezone and an inverted range', () => {
    expect(resolve({ tz: 'Mars/Olympus' })).toEqual({
      ok: false,
      path: ['tz'],
      message: 'Mars/Olympus is not an IANA timezone',
    });
    expect(resolve({ from: '2026-10-23T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z' })).toEqual({
      ok: false,
      path: ['from'],
      message: 'from must not be after to',
    });
  });
});

describe('summarizeRuns', () => {
  it('counts terminal statuses and sums tokens and cost over every run', () => {
    const runs = [
      run('r1', 'bot_ada', 'completed', '2026-10-22T09:00:00.000Z', { tokensIn: 10, tokensOut: 5, costUsd: 0.5 }),
      run('r2', 'bot_ada', 'failed', '2026-10-22T10:00:00.000Z', { tokensIn: 20, tokensOut: 10, costUsd: 0.1 }),
      run('r3', 'bot_grace', 'running', '2026-10-22T11:00:00.000Z', { tokensIn: 5, tokensOut: 1, costUsd: 0.3 }),
      run('r4', 'bot_capy', 'completed', '2026-10-22T12:00:00.000Z', { tokensIn: 1, tokensOut: 1, costUsd: 0 }),
      run('r5', 'bot_ada', 'cancelled', '2026-10-22T13:00:00.000Z'),
    ];
    const { totals, byBot } = summarizeRuns(runs, bots);
    expect(totals).toMatchObject({ runs: 5, completed: 2, failed: 1, cancelled: 1, tokensIn: 36, tokensOut: 17 });
    expect(totals.costUsd).toBeCloseTo(0.9, 10);
    expect(byBot.map((bot) => bot.name)).toEqual(['Ada', 'Grace', 'bot_capy']);
    expect(byBot[0]).toMatchObject({ botId: 'bot_ada', runs: 3, completed: 1, failed: 1, tokensIn: 30, tokensOut: 15 });
    expect(byBot[1]).toMatchObject({ botId: 'bot_grace', runs: 1, completed: 0, failed: 0, tokensIn: 5, tokensOut: 1 });
    expect(byBot[2]).toMatchObject({ name: 'bot_capy', runs: 1 });
  });

  it('sorts by cost, then runs, then bot id', () => {
    const runs = [
      run('a1', 'b_alpha', 'completed', '2026-10-22T09:00:00.000Z', { costUsd: 0.1 }),
      run('b1', 'b_beta', 'completed', '2026-10-22T09:00:00.000Z', { costUsd: 0.05 }),
      run('b2', 'b_beta', 'completed', '2026-10-22T10:00:00.000Z', { costUsd: 0.05 }),
      run('c1', 'b_gamma', 'completed', '2026-10-22T09:00:00.000Z', { costUsd: 0.1 }),
    ];
    const { byBot } = summarizeRuns(runs, new Map());
    expect(byBot.map((bot) => bot.botId)).toEqual(['b_beta', 'b_alpha', 'b_gamma']);
    expect(byBot.map((bot) => bot.runs)).toEqual([2, 1, 1]);
  });

  it('returns zero totals and no shares for an empty window', () => {
    expect(summarizeRuns([], bots)).toEqual({ totals: emptyTodayTotals(), byBot: [] });
  });
});

describe('countRoutineRuns', () => {
  it('counts statuses in the window and merges queued and running', () => {
    const runs = [
      routineRun('completed'),
      routineRun('completed', '2026-10-22T11:00:00.000Z'),
      routineRun('failed'),
      routineRun('skipped'),
      routineRun('running'),
      routineRun('queued'),
      routineRun('missed'),
      routineRun('cancelled'),
    ];
    expect(countRoutineRuns(runs)).toEqual({ completed: 2, failed: 1, skipped: 1, running: 2 });
  });

  it('returns zeros for no routine runs', () => {
    expect(countRoutineRuns([])).toEqual({ completed: 0, failed: 0, skipped: 0, running: 0 });
  });
});
