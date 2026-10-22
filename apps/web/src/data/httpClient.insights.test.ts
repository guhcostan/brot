import type { TodaySummary, UsageSummary } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const totals = { runs: 2, completed: 1, failed: 1, cancelled: 0, tokensIn: 1_000, tokensOut: 400, costUsd: 0.01 };

const today: TodaySummary = {
  from: at,
  to: '2026-10-19T10:00:00.000Z',
  totals,
  byBot: [{ botId: 'bot_1', name: 'Capy', runs: 2, completed: 1, failed: 1, tokensIn: 1_000, tokensOut: 400, costUsd: 0.01 }],
  routines: { completed: 1, failed: 0, skipped: 0, running: 0 },
  pendingApprovals: 2,
  highlights: [{ botId: 'bot_1', botName: 'Capy', threadId: 'thread_1', text: 'Done.', at }],
};

const usage: UsageSummary = {
  from: at,
  to: '2026-10-19T10:00:00.000Z',
  totals,
  groups: [{ key: '2026-10-19', totals }],
};

interface Call {
  method: string;
  path: string;
  search: URLSearchParams;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = { method: init.method ?? 'GET', path: url.pathname, search: url.searchParams };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('today and usage routes', () => {
  it('serializes the Today filters and reads the summary', async () => {
    const { fetch, calls } = fakeFetch(() => json(today));
    const client = createHttpClient({ fetch });

    await expect(client.getToday()).resolves.toEqual(today);
    await expect(
      client.getToday({ from: '2026-10-18T00:00:00.000Z', to: '2026-10-19T00:00:00.000Z', tz: 'America/Sao_Paulo' }),
    ).resolves.toEqual(today);

    expect(calls[0]?.path).toBe('/api/today');
    expect(calls[0]?.search.size).toBe(0);
    expect(calls[1]?.path).toBe('/api/today');
    expect(calls[1]?.search.get('from')).toBe('2026-10-18T00:00:00.000Z');
    expect(calls[1]?.search.get('to')).toBe('2026-10-19T00:00:00.000Z');
    expect(calls[1]?.search.get('tz')).toBe('America/Sao_Paulo');
  });

  it('serializes the Usage filters and reads the summary', async () => {
    const { fetch, calls } = fakeFetch(() => json(usage));
    const client = createHttpClient({ fetch });

    await expect(client.getUsage()).resolves.toEqual(usage);
    await expect(client.getUsage({ botId: 'bot_1', group: 'bot' })).resolves.toEqual(usage);

    expect(calls[0]?.path).toBe('/api/usage');
    expect(calls[0]?.search.size).toBe(0);
    expect(calls[1]?.search.get('botId')).toBe('bot_1');
    expect(calls[1]?.search.get('group')).toBe('bot');
  });

  it('builds the CSV export URL without the grouping', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({})).fetch });

    expect(client.usageExportUrl()).toBe('/api/usage/export.csv');
    expect(client.usageExportUrl({ from: 'a', to: 'b', botId: 'bot_1' })).toBe(
      '/api/usage/export.csv?from=a&to=b&botId=bot_1',
    );
  });

  it('rejects responses that do not match the protocol and surfaces 400 issues', async () => {
    const invalid = createHttpClient({ fetch: fakeFetch(() => json({ totals: {} })).fetch });
    await expect(invalid.getToday()).rejects.toThrow();
    await expect(invalid.getUsage()).rejects.toThrow();

    const refused = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['from'], message: 'from must be an ISO date' }] }, 400)).fetch,
    });
    await expect(refused.getToday({ from: 'yesterday' })).rejects.toThrow('400 Invalid request: from must be an ISO date');
    await expect(refused.getUsage({ from: 'yesterday' })).rejects.toThrow('400 Invalid request: from must be an ISO date');
  });
});
