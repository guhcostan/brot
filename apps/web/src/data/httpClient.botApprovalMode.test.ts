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
  egress: { mode: 'deny', allow: [] },
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

describe('bot approval mode payloads', () => {
  it('does not send approvalMode for the default ask mode', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot, 201));
    const client = createHttpClient({ fetch });

    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none' });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', approvalMode: 'ask' });

    expect(calls[0]?.body).not.toHaveProperty('approvalMode');
    expect(calls[1]?.body).not.toHaveProperty('approvalMode');
    expect(calls[0]?.body).toMatchObject({ name: 'Capy', job: 'Chief', computer: 'none' });
  });

  it('sends approvalMode edits on create', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...bot, approvalMode: 'edits' }, 201));
    const client = createHttpClient({ fetch });

    const created = await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', approvalMode: 'edits' });
    expect(created.approvalMode).toBe('edits');
    expect(calls[0]?.body).toMatchObject({ approvalMode: 'edits' });
  });

  it('patches approvalMode only when the update names it', async () => {
    const { fetch, calls } = fakeFetch((call) => json(call.method === 'PATCH' ? { ...bot, approvalMode: 'edits' } : bot));
    const client = createHttpClient({ fetch });

    await client.updateBot('bot_1', { job: 'Fixer' });
    await client.updateBot('bot_1', { approvalMode: 'edits' });
    await client.updateBot('bot_1', { approvalMode: 'ask' });

    expect(calls[0]?.body).not.toHaveProperty('approvalMode');
    expect(calls[1]?.body).toEqual({ approvalMode: 'edits' });
    expect(calls[2]?.body).toEqual({ approvalMode: 'ask' });
  });

  it('rejects an unknown mode before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot, 201));
    const client = createHttpClient({ fetch });

    await expect(
      // @ts-expect-error an invalid mode is refused by the protocol schema before sending.
      client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', approvalMode: 'always' }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
