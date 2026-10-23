import type { Memory } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';
import type { MemoryUpkeepReport } from '@brot/protocol';

const at = '2026-10-19T09:00:00.000Z';
const memory = (id: string, content: string): Memory => ({ id, botId: 'bot_1', scope: 'bot', kind: 'fact', content, createdAt: at, updatedAt: at });

const report: MemoryUpkeepReport = {
  scope: 'bot',
  botId: 'bot_1',
  total: 3,
  removable: 1,
  groups: [{ kind: 'fact', keep: memory('mem_2', 'Likes tea.'), remove: [memory('mem_1', 'likes tea.')] }],
};

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

describe('memory upkeep routes', () => {
  it('gets the report with scope and botId', async () => {
    const { fetch, calls } = fakeFetch(() => json(report));
    const client = createHttpClient({ fetch });

    await expect(client.getMemoryUpkeep({ scope: 'bot', botId: 'bot_1' })).resolves.toEqual(report);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/memories/upkeep' });
    expect(calls[0]?.search.get('scope')).toBe('bot');
    expect(calls[0]?.search.get('botId')).toBe('bot_1');

    await client.getMemoryUpkeep({ scope: 'workspace' });
    expect(calls[1]?.search.get('scope')).toBe('workspace');
    expect(calls[1]?.search.get('botId')).toBeNull();
  });

  it('rejects an unknown scope before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json(report));
    const client = createHttpClient({ fetch });

    // @ts-expect-error an unknown scope is refused before any request.
    await expect(client.getMemoryUpkeep({ scope: 'team' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('posts the removal ids and reads the result', async () => {
    const removed = [memory('mem_1', 'likes tea.')];
    const { fetch, calls } = fakeFetch(() => json({ removed, kept: [report.groups[0]!.keep] }));
    const client = createHttpClient({ fetch });

    await expect(client.applyMemoryUpkeep({ scope: 'bot', botId: 'bot_1', removeIds: ['mem_1'] })).resolves.toEqual({
      removed,
      kept: [report.groups[0]!.keep],
    });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/memories/upkeep',
      body: { scope: 'bot', botId: 'bot_1', removeIds: ['mem_1'] },
    });
  });

  it('surfaces a 400 instead of removing anything', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ error: 'not a duplicate' }, 400)).fetch });
    await expect(client.applyMemoryUpkeep({ scope: 'workspace', removeIds: ['mem_9'] })).rejects.toThrow('400 not a duplicate');
  });

  it('rejects malformed report and result bodies', async () => {
    const badReport = createHttpClient({ fetch: fakeFetch(() => json({ scope: 'bot', groups: [] })).fetch });
    await expect(badReport.getMemoryUpkeep({ scope: 'bot' })).rejects.toThrow();

    const badResult = createHttpClient({ fetch: fakeFetch(() => json({ removed: [] })).fetch });
    await expect(badResult.applyMemoryUpkeep({ scope: 'bot', removeIds: [] })).rejects.toThrow();
  });
});
