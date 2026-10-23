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

describe('my chrome routes', () => {
  it('reads the settings and availability', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({
          settings: { endpoint: 'http://127.0.0.1:9333', updatedAt: '2026-10-19T09:00:00.000Z' },
          available: true,
          browser: { version: 'Chrome/142.0.7339.82', userAgent: 'Mozilla/5.0 Chrome/142.0.7339.82 Safari/537.36' },
          automation: true,
          hint: 'Close that browser and start your own Chrome.',
        }),
    );
    const client = createHttpClient({ fetch });

    await expect(client.getMyChrome()).resolves.toEqual({
      settings: { endpoint: 'http://127.0.0.1:9333', updatedAt: '2026-10-19T09:00:00.000Z' },
      available: true,
      browser: { version: 'Chrome/142.0.7339.82', userAgent: 'Mozilla/5.0 Chrome/142.0.7339.82 Safari/537.36' },
      automation: true,
      hint: 'Close that browser and start your own Chrome.',
    });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/my-chrome' });
  });

  it('falls back to the default endpoint for an empty or missing payload', async () => {
    const empty = createHttpClient({ fetch: fakeFetch(() => json({})).fetch });
    await expect(empty.getMyChrome()).resolves.toEqual({
      settings: { endpoint: 'http://127.0.0.1:9333' },
      available: false,
    });
  });

  it('puts a loopback endpoint', async () => {
    const { fetch, calls } = fakeFetch(() => json({ settings: { endpoint: 'http://127.0.0.1:9444' }, available: true }));
    const client = createHttpClient({ fetch });

    await expect(client.updateMyChrome({ endpoint: 'http://127.0.0.1:9444' })).resolves.toMatchObject({
      settings: { endpoint: 'http://127.0.0.1:9444' },
      available: true,
    });
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/my-chrome', body: { endpoint: 'http://127.0.0.1:9444' } });
  });

  it('refuses non-loopback, non-http and empty endpoints before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json({ settings: { endpoint: 'http://127.0.0.1:9222' }, available: true }));
    const client = createHttpClient({ fetch });

    await expect(client.updateMyChrome({ endpoint: 'http://192.168.1.20:9222' })).rejects.toThrow();
    await expect(client.updateMyChrome({ endpoint: 'ftp://127.0.0.1:9222' })).rejects.toThrow();
    await expect(client.updateMyChrome({ endpoint: '   ' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces a 400 from the server', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ error: 'endpoint must be loopback' }, 400)).fetch });

    await expect(client.updateMyChrome({ endpoint: 'http://localhost:9222' })).rejects.toThrow('400 endpoint must be loopback');
  });
});
