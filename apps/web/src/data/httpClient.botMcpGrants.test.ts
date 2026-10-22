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

describe('bot MCP grants payloads', () => {
  it('sends mcpServerIds on create only for an allowlist, empty list included', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...bot, mcpServerIds: ['mcp_1'] }, 201));
    const client = createHttpClient({ fetch });

    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', mcpServerIds: ['mcp_1'] });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', mcpServerIds: [] });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none' });
    await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', mcpServerIds: null });

    expect(calls[0]?.body).toMatchObject({ mcpServerIds: ['mcp_1'] });
    expect(calls[1]?.body).toMatchObject({ mcpServerIds: [] });
    expect(calls[2]?.body).not.toHaveProperty('mcpServerIds');
    expect(calls[3]?.body).not.toHaveProperty('mcpServerIds');
  });

  it('patches an allowlist, a cleared one and clears back to every server', async () => {
    const { fetch, calls } = fakeFetch((call) => json({ ...bot, ...(call.body ?? {}) }));
    const client = createHttpClient({ fetch });

    await client.updateBot('bot_1', { mcpServerIds: ['mcp_1', 'mcp_2'] });
    await client.updateBot('bot_1', { mcpServerIds: [] });
    await client.updateBot('bot_1', { mcpServerIds: null });
    await client.updateBot('bot_1', { job: 'Fixer' });

    expect(calls[0]?.body).toEqual({ mcpServerIds: ['mcp_1', 'mcp_2'] });
    expect(calls[1]?.body).toEqual({ mcpServerIds: [] });
    expect(calls[2]?.body).toEqual({ mcpServerIds: null });
    expect(calls[3]?.body).not.toHaveProperty('mcpServerIds');
  });

  it('reads the grants the server returns on list and create', async () => {
    const granted = { ...bot, mcpServerIds: ['mcp_1'] };
    const { fetch } = fakeFetch((call) => (call.method === 'GET' ? json([granted, bot]) : json(granted, 201)));
    const client = createHttpClient({ fetch });

    const bots = await client.listBots();
    expect(bots.map((entry) => entry.mcpServerIds)).toEqual([['mcp_1'], undefined]);
    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', mcpServerIds: ['mcp_1'] })).resolves.toMatchObject({
      mcpServerIds: ['mcp_1'],
    });
  });

  it('rejects an unknown server id before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', mcpServerIds: [''] })).rejects.toThrow();
    await expect(client.updateBot('bot_1', { mcpServerIds: Array.from({ length: 51 }, () => 'mcp_1') })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces the 400 issue for unknown servers', async () => {
    const client = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['mcpServerIds'], message: 'unknown MCP server mcp_9' }] }, 400)).fetch,
    });

    await expect(client.updateBot('bot_1', { mcpServerIds: ['mcp_9'] })).rejects.toThrow(
      '400 Invalid request: unknown MCP server mcp_9',
    );
  });
});
