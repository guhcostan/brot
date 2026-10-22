import { describe, expect, it } from 'vitest';
import { ScreenUnavailable } from './client';
import { createHttpClient, type FetchLike } from './httpClient';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('browser live view routes', () => {
  it('returns the JPEG frame as a Blob', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(new Blob(['jpeg'], { type: 'image/jpeg' }), { status: 200 }));
    const client = createHttpClient({ fetch });

    const blob = await client.browserScreen('bot_1');
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/bots/bot_1/browser/screen' });
  });

  it('maps a 409 screen failure to ScreenUnavailable', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'The browser could not start' }, 409));
    const client = createHttpClient({ fetch });

    const failure = await client.browserScreen('bot_1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ScreenUnavailable);
    expect((failure as ScreenUnavailable).status).toBe(409);
  });

  it('maps a 404 screen failure to ScreenUnavailable and surfaces other errors', async () => {
    const missing = createHttpClient({ fetch: fakeFetch(() => json({ error: 'not found' }, 404)).fetch });
    await expect(missing.browserScreen('bot_1')).rejects.toBeInstanceOf(ScreenUnavailable);

    const broken = createHttpClient({ fetch: fakeFetch(() => json({ error: 'boom' }, 500)).fetch });
    await expect(broken.browserScreen('bot_1')).rejects.toThrow('500 boom');
  });

  it('reads and sets the takeover', async () => {
    const { fetch, calls } = fakeFetch((call) => json(call.method === 'POST' ? { active: true, since: '2026-10-19T09:00:00.000Z' } : { active: false }));
    const client = createHttpClient({ fetch });

    await expect(client.getBrowserTakeover('bot_1')).resolves.toEqual({ active: false });
    await expect(client.setBrowserTakeover('bot_1', { active: true })).resolves.toEqual({ active: true, since: '2026-10-19T09:00:00.000Z' });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/bots/bot_1/browser/takeover',
      'POST /api/bots/bot_1/browser/takeover',
    ]);
    expect(calls[1]?.body).toEqual({ active: true });
  });

  it('posts input events and validates them before any request', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch });

    await expect(client.browserInput('bot_1', { type: 'click', x: 640, y: 400, button: 'left', double: false })).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/bots/bot_1/browser/input' });
    expect(calls[0]?.body).toEqual({ type: 'click', x: 640, y: 400, button: 'left', double: false });

    await expect(client.browserInput('bot_1', { type: 'key', key: 'rm -rf' })).rejects.toThrow();
    await expect(client.browserInput('bot_1', { type: 'click', x: 99_999, y: 0, button: 'left', double: false })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('surfaces the 409 of input without a takeover', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'No takeover is active.' }, 409));
    const client = createHttpClient({ fetch });

    await expect(client.browserInput('bot_1', { type: 'key', key: 'Enter' })).rejects.toThrow('409 No takeover is active.');
  });
});
