import { describe, expect, it } from 'vitest';
import type { Decision } from '@brot/protocol';
import { createHttpClient, type FetchLike } from './httpClient';

const decision: Decision = {
  id: 'dec_1',
  runId: 'run_1',
  threadId: 'thr_1',
  botId: 'bot_1',
  kind: 'send',
  tool: 'gmail.send',
  summary: 'Send the follow-up to Ana',
  decision: 'deny',
  reply: 'Wait for the fix.',
  decidedAt: '2026-10-19T09:00:00.000Z',
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

describe('decision routes', () => {
  it('lists decisions with serialized filters', async () => {
    const { fetch, calls } = fakeFetch(() => json([decision]));
    const client = createHttpClient({ fetch });

    await expect(client.listDecisions()).resolves.toEqual([decision]);
    await client.listDecisions({
      from: '2026-10-18T00:00:00.000Z',
      to: '2026-10-19T00:00:00.000Z',
      botId: 'bot_1',
      decision: 'allow_once',
      limit: 10,
    });

    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/decisions' });
    expect(calls[0]?.search.size).toBe(1);
    expect(calls[0]?.search.get('limit')).toBe('50');
    expect(calls[1]?.search.get('from')).toBe('2026-10-18T00:00:00.000Z');
    expect(calls[1]?.search.get('to')).toBe('2026-10-19T00:00:00.000Z');
    expect(calls[1]?.search.get('botId')).toBe('bot_1');
    expect(calls[1]?.search.get('decision')).toBe('allow_once');
    expect(calls[1]?.search.get('limit')).toBe('10');
  });

  it('builds the CSV export URL from the same filters, without a limit', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json([])).fetch });

    expect(client.decisionsExportUrl()).toBe('/api/decisions/export.csv');
    expect(client.decisionsExportUrl({ from: 'a', to: 'b', botId: 'bot_1', decision: 'deny' })).toBe(
      '/api/decisions/export.csv?from=a&to=b&botId=bot_1&decision=deny',
    );
  });

  it('rejects a bad decision or limit before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch });

    await expect(
      // @ts-expect-error an unknown outcome is refused before any request.
      client.listDecisions({ decision: 'maybe' }),
    ).rejects.toThrow();
    await expect(client.listDecisions({ limit: 0 })).rejects.toThrow();
    await expect(client.listDecisions({ limit: 201 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces a 400 issue and rejects a malformed response', async () => {
    const refused = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['limit'], message: 'limit must be 1..200' }] }, 400)).fetch,
    });
    await expect(refused.listDecisions({ limit: 5 })).rejects.toThrow('400 Invalid request: limit must be 1..200');

    const malformed = createHttpClient({ fetch: fakeFetch(() => json([{ id: 'dec_1' }])).fetch });
    await expect(malformed.listDecisions()).rejects.toThrow();
  });

  it('reads decisions without a reply', async () => {
    const { reply: _reply, ...plain } = decision;
    const { fetch } = fakeFetch(() => json([plain]));
    const client = createHttpClient({ fetch });

    await expect(client.listDecisions()).resolves.toEqual([plain]);
  });
});
