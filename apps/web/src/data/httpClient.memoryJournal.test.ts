import type { Memory } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import type { MemoryJournalEntry } from '@brot/protocol';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const memory: Memory = { id: 'mem_1', botId: 'bot_1', scope: 'bot', kind: 'fact', content: 'Acme renews in June.', createdAt: at, updatedAt: at };

const entry = (overrides: Partial<MemoryJournalEntry> = {}): MemoryJournalEntry => ({
  id: 'j_1',
  memoryId: 'mem_1',
  botId: 'bot_1',
  scope: 'bot',
  kind: 'fact',
  action: 'created',
  contentAfter: 'Acme renews in June.',
  at,
  ...overrides,
});

interface Call {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      search: url.searchParams,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('memory journal routes', () => {
  it('lists entries with the filters and a default limit of 50', async () => {
    const { fetch, calls } = fakeFetch(() => json([entry(), entry({ id: 'j_2', action: 'deleted', contentBefore: 'Old fact', contentAfter: undefined })]));
    const client = createHttpClient({ fetch });

    const listed = await client.listMemoryJournal({ botId: 'bot_1', scope: 'bot' });
    expect(listed.map((item) => item.action)).toEqual(['created', 'deleted']);
    expect(calls[0]?.path).toBe('/api/memories/journal');
    expect(calls[0]?.search.get('botId')).toBe('bot_1');
    expect(calls[0]?.search.get('scope')).toBe('bot');
    expect(calls[0]?.search.get('limit')).toBe('50');

    await client.listMemoryJournal({ scope: 'workspace', limit: 5 });
    expect(calls[1]?.search.get('limit')).toBe('5');
    expect(calls[1]?.search.get('botId')).toBeNull();
  });

  it('rejects a bad scope or limit before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch });

    await expect(client.listMemoryJournal({ limit: 0 })).rejects.toThrow();
    await expect(client.listMemoryJournal({ limit: 201 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('posts an undo and reads the restored memory', async () => {
    const { fetch, calls } = fakeFetch(() => json({ result: 'restored', memory }));
    const client = createHttpClient({ fetch });

    await expect(client.undoMemoryJournal('j_1')).resolves.toEqual({ result: 'restored', memory });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/memories/journal/j_1/undo', body: {} });
  });

  it('reads an undo that removed a memory', async () => {
    const { fetch } = fakeFetch(() => json({ result: 'removed' }));
    const client = createHttpClient({ fetch });

    await expect(client.undoMemoryJournal('j_2')).resolves.toEqual({ result: 'removed' });
  });

  it('surfaces 409 conflicts and 404s', async () => {
    const conflict = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Memory changed since that entry' }, 409)).fetch });
    await expect(conflict.undoMemoryJournal('j_1')).rejects.toThrow('409 Memory changed since that entry');

    const missing = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Journal entry not found' }, 404)).fetch });
    await expect(missing.undoMemoryJournal('nope')).rejects.toThrow('404 Journal entry not found');
  });

  it('rejects a malformed journal entry', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json([{ id: 'j_1' }])).fetch });
    await expect(client.listMemoryJournal()).rejects.toThrow();
  });
});
