import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('room decider routes', () => {
  it('reads the settings and rejects a malformed body', async () => {
    const { fetch, calls } = fakeFetch(() => json({ model: 'opencode-go/deepseek-v4.1-flash', updatedAt: '2026-10-19T09:00:00.000Z' }));
    const client = createHttpClient({ fetch });

    await expect(client.getRoomDeciderSettings()).resolves.toEqual({
      model: 'opencode-go/deepseek-v4.1-flash',
      updatedAt: '2026-10-19T09:00:00.000Z',
    });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/room-decider' });

    const unset = createHttpClient({ fetch: fakeFetch(() => json({})).fetch });
    await expect(unset.getRoomDeciderSettings()).resolves.toEqual({});

    const broken = createHttpClient({ fetch: fakeFetch(() => json({ model: 42 })).fetch });
    await expect(broken.getRoomDeciderSettings()).rejects.toThrow();
  });

  it('puts the chosen model', async () => {
    const { fetch, calls } = fakeFetch(() => json({ model: 'opencode-go/deepseek-v4.1-flash', updatedAt: '2026-10-19T09:00:00.000Z' }));
    const client = createHttpClient({ fetch });

    await expect(client.updateRoomDeciderSettings({ model: 'opencode-go/deepseek-v4.1-flash' })).resolves.toMatchObject({
      model: 'opencode-go/deepseek-v4.1-flash',
    });
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      path: '/api/room-decider',
      body: { model: 'opencode-go/deepseek-v4.1-flash' },
    });
  });

  it('clears with a null model', async () => {
    const { fetch, calls } = fakeFetch(() => json({ updatedAt: '2026-10-19T09:00:00.000Z' }));
    const client = createHttpClient({ fetch });

    await expect(client.updateRoomDeciderSettings({ model: null })).resolves.toEqual({ updatedAt: '2026-10-19T09:00:00.000Z' });
    expect(calls[0]?.body).toEqual({ model: null });
  });

  it('rejects a blank model locally and surfaces a 400', async () => {
    const { fetch, calls } = fakeFetch(() => json({ error: 'Unsupported provider' }, 400));
    const client = createHttpClient({ fetch });

    await expect(client.updateRoomDeciderSettings({ model: '   ' })).rejects.toThrow();
    expect(calls).toHaveLength(0);

    await expect(client.updateRoomDeciderSettings({ model: 'anthropic/claude-sonnet' })).rejects.toThrow('400 Unsupported provider');
  });
});
