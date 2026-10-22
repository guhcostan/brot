import { TodaySummary, UsageSummary } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dmThreadOf } from './fixtures';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock today summary', () => {
  it('returns a protocol-valid summary with per-bot shares and highlights', async () => {
    const client = createMockClient();
    const summary = await client.getToday();
    expect(() => TodaySummary.parse(summary)).not.toThrow();

    const byBotRuns = summary.byBot.reduce((sum, bot) => sum + bot.runs, 0);
    expect(summary.totals.runs).toBe(byBotRuns);
    expect(summary.byBot.map((bot) => bot.name)).toEqual(expect.arrayContaining(['Capy', 'Onça', 'Tuca', 'Tamu']));
    expect(summary.totals.completed).toBe(summary.byBot.reduce((sum, bot) => sum + bot.completed, 0));
    expect(summary.pendingApprovals).toBe(1);
    expect(summary.routines.completed).toBeGreaterThan(0);

    expect(summary.highlights.length).toBeGreaterThan(0);
    for (const highlight of summary.highlights) {
      expect(highlight.threadId).toBe(dmThreadOf(highlight.botId));
      expect(highlight.text.length).toBeGreaterThan(0);
    }
  });

  it('honours an explicit window', async () => {
    const client = createMockClient();
    const summary = await client.getToday({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' });
    expect(summary.from).toBe('2026-09-01T00:00:00.000Z');
    expect(summary.to).toBe('2026-09-02T00:00:00.000Z');
  });
});

describe('mock usage summary', () => {
  it('groups by UTC day by default with sorted keys and matching totals', async () => {
    const client = createMockClient();
    const usage = await client.getUsage();
    expect(() => UsageSummary.parse(usage)).not.toThrow();

    expect(usage.groups.length).toBe(7);
    const keys = usage.groups.map((group) => group.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys.every((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))).toBe(true);
    expect(usage.groups.every((group) => group.label === undefined)).toBe(true);
    expect(usage.totals.runs).toBe(usage.groups.reduce((sum, group) => sum + group.totals.runs, 0));
    expect(usage.totals.costUsd).toBeCloseTo(usage.groups.reduce((sum, group) => sum + group.totals.costUsd, 0));
  });

  it('groups by bot with named labels and supports a bot filter', async () => {
    const client = createMockClient();
    const byBot = await client.getUsage({ group: 'bot' });
    expect(() => UsageSummary.parse(byBot)).not.toThrow();
    expect(byBot.groups.map((group) => group.label)).toEqual(['Capy', 'Onça', 'Tuca', 'Tamu']);
    expect(byBot.totals.runs).toBe(byBot.groups.reduce((sum, group) => sum + group.totals.runs, 0));

    const one = await client.getUsage({ group: 'bot', botId: 'bot_capy' });
    expect(one.groups).toHaveLength(1);
    expect(one.groups[0]?.label).toBe('Capy');
    expect(one.totals.runs).toBe(one.groups[0]?.totals.runs);
  });

  it('returns the CSV export path with the same range', async () => {
    const client = createMockClient();
    expect(client.usageExportUrl()).toBe('/api/usage/export.csv');
    expect(client.usageExportUrl({ from: 'a', to: 'b', botId: 'bot_capy' })).toBe(
      '/api/usage/export.csv?from=a&to=b&botId=bot_capy',
    );
  });
});
