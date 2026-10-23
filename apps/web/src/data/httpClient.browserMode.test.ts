import type { Bot } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const bot = (extra: Partial<Bot> = {}): Bot => ({
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'dsh',
  computer: 'sandbox',
  browser: true,
  egress: { mode: 'deny', allow: [] },
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const path = new URL(input, 'http://brot.test').pathname;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    return respond({ method: init.method ?? 'GET', path, body });
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('bot browserMode payloads', () => {
  it('sends browserMode my-chrome on create only when the bot browses', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot({ browserMode: 'my-chrome' })));
    const client = createHttpClient({ fetch });

    await client.createBot({ name: 'Capy', job: 'Chief of Staff', browser: true, browserMode: 'my-chrome' });

    expect(calls[0]?.body).toMatchObject({ browser: true, browserMode: 'my-chrome' });
  });

  it('omits browserMode when it is own/absent', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot()));
    const client = createHttpClient({ fetch });

    await client.createBot({ name: 'Capy', job: 'Chief of Staff', browser: true });
    await client.createBot({ name: 'Capy', job: 'Chief of Staff', browser: true, browserMode: 'own' });

    expect(calls[0]?.body).not.toHaveProperty('browserMode');
    expect(calls[1]?.body).not.toHaveProperty('browserMode');
  });

  it('rejects my-chrome without a browser before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot()));
    const client = createHttpClient({ fetch });

    await expect(client.createBot({ name: 'Capy', job: 'Chief of Staff', browser: false, browserMode: 'my-chrome' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('patches browserMode, including switching back to own', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot()));
    const client = createHttpClient({ fetch });

    await client.updateBot('bot_1', { browserMode: 'my-chrome' });
    await client.updateBot('bot_1', { browserMode: 'own' });

    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/bots/bot_1', body: { browserMode: 'my-chrome' } });
    expect(calls[1]?.body).toEqual({ browserMode: 'own' });
  });
});
