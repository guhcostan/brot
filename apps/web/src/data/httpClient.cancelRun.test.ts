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
    calls.push({ method: init.method ?? 'GET', path, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return respond({ method: init.method ?? 'GET', path, body: undefined });
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('cancelRun', () => {
  it('posts to the cancel route', async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: 'run_1', status: 'cancelled' }));
    const client = createHttpClient({ fetch });

    await expect(client.cancelRun('run_1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/runs/run_1/cancel', body: {} });
  });

  it('surfaces a 404 for an unknown run', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Run not found' }, 404)).fetch });

    await expect(client.cancelRun('nope')).rejects.toThrow('404 Run not found');
  });
});
