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

describe('bot budget payloads', () => {
  it('sends both caps on create only when set', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...bot, runBudgetUsd: 0.5, dailyBudgetUsd: 2 }, 201));
    const client = createHttpClient({ fetch });

    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', runBudgetUsd: 0.5, dailyBudgetUsd: 2 });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', runBudgetUsd: 0 });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none' });

    expect(calls[0]?.body).toMatchObject({ runBudgetUsd: 0.5, dailyBudgetUsd: 2 });
    expect(calls[1]?.body).toMatchObject({ runBudgetUsd: 0 });
    expect(calls[1]?.body).not.toHaveProperty('dailyBudgetUsd');
    expect(calls[2]?.body).not.toHaveProperty('runBudgetUsd');
    expect(calls[2]?.body).not.toHaveProperty('dailyBudgetUsd');
  });

  it('patches numbers and clears with null', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      const body = call.body ?? {};
      const { runBudgetUsd, dailyBudgetUsd, ...rest } = body as { runBudgetUsd?: number | null; dailyBudgetUsd?: number | null } & Record<string, unknown>;
      return json({
        ...bot,
        ...rest,
        ...(typeof runBudgetUsd === 'number' ? { runBudgetUsd } : {}),
        ...(typeof dailyBudgetUsd === 'number' ? { dailyBudgetUsd } : {}),
      });
    });
    const client = createHttpClient({ fetch });

    await client.updateBot('bot_1', { runBudgetUsd: 1.25, dailyBudgetUsd: 5 });
    await client.updateBot('bot_1', { runBudgetUsd: null });
    await client.updateBot('bot_1', { dailyBudgetUsd: null });
    await client.updateBot('bot_1', { job: 'Fixer' });

    expect(calls[0]?.body).toEqual({ runBudgetUsd: 1.25, dailyBudgetUsd: 5 });
    expect(calls[1]?.body).toEqual({ runBudgetUsd: null });
    expect(calls[2]?.body).toEqual({ dailyBudgetUsd: null });
    expect(calls[3]?.body).not.toHaveProperty('runBudgetUsd');
    expect(calls[3]?.body).not.toHaveProperty('dailyBudgetUsd');
  });

  it('reads the caps back from list and create responses', async () => {
    const capped = { ...bot, runBudgetUsd: 0.5, dailyBudgetUsd: 2 };
    const { fetch } = fakeFetch((call) => (call.method === 'GET' ? json([capped, bot]) : json(capped, 201)));
    const client = createHttpClient({ fetch });

    await expect(client.listBots()).resolves.toMatchObject([{ runBudgetUsd: 0.5, dailyBudgetUsd: 2 }, {}]);
    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', runBudgetUsd: 0.5 })).resolves.toMatchObject({
      runBudgetUsd: 0.5,
      dailyBudgetUsd: 2,
    });
  });

  it('rejects negative and non-finite values before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', runBudgetUsd: -1 })).rejects.toThrow();
    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', dailyBudgetUsd: Number.POSITIVE_INFINITY })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces the 400 issue for a refused cap', async () => {
    const client = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['runBudgetUsd'], message: 'a budget cannot be negative' }] }, 400)).fetch,
    });

    await expect(client.updateBot('bot_1', { runBudgetUsd: 5 })).rejects.toThrow('400 Invalid request: a budget cannot be negative');
  });
});
