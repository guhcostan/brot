import type { Thread } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const thread: Thread = { id: 'thr_1', botId: 'bot_1', title: 'Planning', createdAt: at, updatedAt: at };

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

describe('thread updates', () => {
  it('patches a title, a model override and a cleared model', async () => {
    const { fetch, calls } = fakeFetch(() => json(thread));
    const client = createHttpClient({ fetch });

    await expect(client.updateThread('thr_1', { title: 'Q4 planning' })).resolves.toEqual(thread);
    await client.updateThread('thr_1', { model: 'opencode-go/deepseek-v4.1-flash' });
    await client.updateThread('thr_1', { model: null });

    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/threads/thr_1' });
    expect(calls[0]?.body).toEqual({ title: 'Q4 planning' });
    expect(calls[1]?.body).toEqual({ model: 'opencode-go/deepseek-v4.1-flash' });
    expect(calls[2]?.body).toEqual({ model: null });
  });

  it('rejects an empty patch and a malformed model before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(thread));
    const client = createHttpClient({ fetch });

    await expect(client.updateThread('thr_1', {})).rejects.toThrow();
    await expect(client.updateThread('thr_1', { title: '' })).rejects.toThrow();
    await expect(client.updateThread('thr_1', { model: 'no-slash' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces 400 and 404', async () => {
    const refused = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['title'], message: 'too long' }] }, 400)).fetch,
    });
    await expect(refused.updateThread('thr_1', { title: 'x' })).rejects.toThrow('400 Invalid request: too long');

    const missing = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Thread not found' }, 404)).fetch });
    await expect(missing.updateThread('nope', { title: 'x' })).rejects.toThrow('404 Thread not found');
  });
});

describe('room deletion', () => {
  it('deletes a room with 204', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch });

    await expect(client.deleteRoom('room_1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/rooms/room_1' });
  });

  it('surfaces a 404 for an unknown room', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Room not found' }, 404)).fetch });

    await expect(client.deleteRoom('nope')).rejects.toThrow('404 Room not found');
  });
});
