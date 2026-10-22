import type { Bot } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const path = new URL(input, 'http://brot.test').pathname;
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('bot fallback model payloads', () => {
  it('sends an ordered fallback list on create only when non-empty', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...bot, fallbackModels: ['p/a', 'p/b'] }, 201));
    const client = createHttpClient({ fetch });

    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', fallbackModels: ['p/a', 'p/b'] });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', fallbackModels: [] });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none' });

    expect(calls[0]?.body).toMatchObject({ fallbackModels: ['p/a', 'p/b'] });
    expect(calls[1]?.body).not.toHaveProperty('fallbackModels');
    expect(calls[2]?.body).not.toHaveProperty('fallbackModels');
  });

  it('patches an ordered list and clears with null', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      const body = call.body ?? {};
      const { fallbackModels, ...rest } = body as { fallbackModels?: string[] | null } & Record<string, unknown>;
      return json({ ...bot, ...rest, ...(Array.isArray(fallbackModels) ? { fallbackModels } : {}) });
    });
    const client = createHttpClient({ fetch });

    await client.updateBot('bot_1', { fallbackModels: ['p/a', 'p/b'] });
    await client.updateBot('bot_1', { fallbackModels: null });
    await client.updateBot('bot_1', { job: 'Fixer' });

    expect(calls[0]?.body).toEqual({ fallbackModels: ['p/a', 'p/b'] });
    expect(calls[1]?.body).toEqual({ fallbackModels: null });
    expect(calls[2]?.body).not.toHaveProperty('fallbackModels');
  });

  it('keeps the order the server returns on list and create', async () => {
    const granted = { ...bot, fallbackModels: ['p/b', 'p/a'] };
    const { fetch } = fakeFetch((call) => (call.method === 'GET' ? json([granted]) : json(granted, 201)));
    const client = createHttpClient({ fetch });

    await expect(client.listBots()).resolves.toMatchObject([{ fallbackModels: ['p/b', 'p/a'] }]);
    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', fallbackModels: ['p/b', 'p/a'] })).resolves.toMatchObject({
      fallbackModels: ['p/b', 'p/a'],
    });
  });

  it('rejects an over-long list or duplicates before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot, 201));
    const client = createHttpClient({ fetch });

    await expect(
      client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', fallbackModels: ['p/a', 'p/b', 'p/c', 'p/d'] }),
    ).rejects.toThrow();
    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', fallbackModels: ['p/a', 'p/a'] })).rejects.toThrow();
    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', fallbackModels: ['not-a-ref'] })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces the 400 issue for an unknown fallback', async () => {
    const client = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['fallbackModels'], message: 'unknown model vendor/model' }] }, 400)).fetch,
    });

    await expect(client.updateBot('bot_1', { fallbackModels: ['vendor/model'] })).rejects.toThrow(
      '400 Invalid request: unknown model vendor/model',
    );
  });
});
