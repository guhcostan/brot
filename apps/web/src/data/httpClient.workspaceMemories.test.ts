import type { Memory } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const workspaceMemory: Memory = {
  id: 'wmem_1',
  scope: 'workspace',
  kind: 'preference',
  content: 'Prefers Portuguese.',
  createdAt: at,
  updatedAt: at,
};

const botMemory: Memory = {
  id: 'mem_1',
  botId: 'bot_1',
  scope: 'bot',
  kind: 'fact',
  content: 'The Acme renewal is the priority.',
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

describe('workspace memory routes', () => {
  it('lists workspace facts', async () => {
    const { fetch, calls } = fakeFetch(() => json([workspaceMemory]));
    const client = createHttpClient({ fetch });

    await expect(client.listWorkspaceMemories()).resolves.toEqual([workspaceMemory]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/profile/memories' });
  });

  it('creates a workspace fact with only kind and content', async () => {
    const { fetch, calls } = fakeFetch(() => json(workspaceMemory, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createWorkspaceMemory({ kind: 'preference', content: 'Prefers Portuguese.' })).resolves.toEqual(workspaceMemory);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/profile/memories' });
    expect(calls[0]?.body).toEqual({ kind: 'preference', content: 'Prefers Portuguese.' });
  });

  it('updates and deletes through the shared memory routes', async () => {
    const updated = { ...workspaceMemory, content: 'Prefers Portuguese (pt-BR).', updatedAt: '2026-10-20T09:00:00.000Z' };
    const { fetch, calls } = fakeFetch((call) => (call.method === 'PATCH' ? json(updated) : new Response(null, { status: 204 })));
    const client = createHttpClient({ fetch });

    await expect(client.updateMemory('wmem_1', { content: updated.content })).resolves.toEqual(updated);
    await expect(client.deleteMemory('wmem_1')).resolves.toBeUndefined();
    await expect(client.updateMemory('mem_1', { kind: 'summary' })).resolves.toEqual(updated);

    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/memories/wmem_1', body: { content: updated.content } });
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/api/memories/wmem_1' });
  });

  it('surfaces 400 issues and 404s', async () => {
    const refused = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['content'], message: 'content is required' }] }, 400)).fetch,
    });
    await expect(refused.createWorkspaceMemory({ kind: 'fact', content: '' })).rejects.toThrow('400 Invalid request: content is required');

    const missing = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Memory not found' }, 404)).fetch });
    await expect(missing.updateMemory('nope', { content: 'x' })).rejects.toThrow('404 Memory not found');
    await expect(missing.deleteMemory('nope')).rejects.toThrow('404 Memory not found');
  });

  it('rejects a workspace body that names a bot before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(workspaceMemory, 201));
    const client = createHttpClient({ fetch });

    await expect(
      // @ts-expect-error a workspace fact has no botId; the strict protocol schema refuses one.
      client.createWorkspaceMemory({ kind: 'fact', content: 'x', botId: 'bot_1' }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('keeps parsing bot-scope memories with their botId', async () => {
    const { fetch } = fakeFetch(() => json([botMemory]));
    const client = createHttpClient({ fetch });

    await expect(client.listMemories('bot_1')).resolves.toEqual([botMemory]);
  });
});
