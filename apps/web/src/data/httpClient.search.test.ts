import type { SearchHit } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const hit: SearchHit = {
  messageId: 'msg_1',
  threadId: 'thread_1',
  threadTitle: 'Morning',
  botId: 'bot_1',
  botName: 'Capy',
  role: 'assistant',
  snippet: 'The Acme renewal is ready.',
  createdAt: '2026-10-19T09:00:00.000Z',
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

describe('message search route', () => {
  it('serializes the query filters and reads the hits', async () => {
    const { fetch, calls } = fakeFetch(() => json([hit]));
    const client = createHttpClient({ fetch });

    await expect(client.searchMessages({ q: '  acme renewal  ' })).resolves.toEqual([hit]);
    await client.searchMessages({ q: 'acme', botId: 'bot_1', threadId: 'thread_1', limit: 8, before: '2026-10-20T00:00:00.000Z' });

    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/search' });
    expect(calls[0]?.search.get('q')).toBe('acme renewal');
    expect(calls[0]?.search.get('limit')).toBe('20');
    expect(calls[1]?.search.get('q')).toBe('acme');
    expect(calls[1]?.search.get('botId')).toBe('bot_1');
    expect(calls[1]?.search.get('threadId')).toBe('thread_1');
    expect(calls[1]?.search.get('limit')).toBe('8');
    expect(calls[1]?.search.get('before')).toBe('2026-10-20T00:00:00.000Z');
  });

  it('rejects blank or oversized queries before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch });

    await expect(client.searchMessages({ q: '   ' })).rejects.toThrow();
    await expect(client.searchMessages({ q: '' })).rejects.toThrow();
    await expect(client.searchMessages({ q: 'x'.repeat(201) })).rejects.toThrow();
    await expect(client.searchMessages({ q: 'acme', limit: 0 })).rejects.toThrow();
    await expect(client.searchMessages({ q: 'acme', limit: 51 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces a 400 issue and rejects a malformed response', async () => {
    const refused = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['q'], message: 'q must not be blank' }] }, 400)).fetch,
    });
    await expect(refused.searchMessages({ q: 'acme' })).rejects.toThrow('400 Invalid request: q must not be blank');

    const malformed = createHttpClient({ fetch: fakeFetch(() => json([{ messageId: 'msg_1' }])).fetch });
    await expect(malformed.searchMessages({ q: 'acme' })).rejects.toThrow();
  });
});
