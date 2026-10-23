import type { AdminActivity } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';
const entry = (overrides: Partial<AdminActivity> = {}): AdminActivity => ({
  id: 'act_1',
  action: 'created',
  targetType: 'bot',
  targetId: 'bot_1',
  summary: 'Created bot Capy',
  actor: 'local',
  at,
  ...overrides,
});

interface Call {
  method: string;
  path: string;
  search: URLSearchParams;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call = { method: init.method ?? 'GET', path: url.pathname, search: url.searchParams };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('admin activity route', () => {
  it('lists entries with the default limit of 50', async () => {
    const { fetch, calls } = fakeFetch(() => json([entry(), entry({ id: 'act_2', action: 'deleted' })]));
    const client = createHttpClient({ fetch });

    const list = await client.listAdminActivity();
    expect(list.map((item) => item.action)).toEqual(['created', 'deleted']);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/activity' });
    expect(calls[0]?.search.get('limit')).toBe('50');
  });

  it('sends a custom limit', async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch });

    await client.listAdminActivity({ limit: 10 });
    expect(calls[0]?.search.get('limit')).toBe('10');
  });

  it('rejects a bad limit before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch });

    await expect(client.listAdminActivity({ limit: 0 })).rejects.toThrow();
    await expect(client.listAdminActivity({ limit: 201 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces a 400 and rejects a malformed entry', async () => {
    const refused = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Invalid limit' }, 400)).fetch });
    await expect(refused.listAdminActivity({ limit: 5 })).rejects.toThrow('400 Invalid limit');

    const malformed = createHttpClient({ fetch: fakeFetch(() => json([{ id: 'act_1' }])).fetch });
    await expect(malformed.listAdminActivity()).rejects.toThrow();
  });
});
