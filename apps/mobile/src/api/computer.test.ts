import { describe, expect, it } from 'vitest';
import { createClient, toBase64 } from './client';
import { fakeFetch, headersOf, json, T0 } from '../testing';

const BASE = 'http://192.168.1.20:8799';

describe('computer and team endpoints', () => {
  it('encodes base64 with padding', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(toBase64(bytes(''))).toBe('');
    expect(toBase64(bytes('f'))).toBe('Zg==');
    expect(toBase64(bytes('fo'))).toBe('Zm8=');
    expect(toBase64(bytes('foobar'))).toBe('Zm9vYmFy');
    expect(toBase64(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('/9j/');
  });

  it('reads a frame as a JPEG data URI and maps 404 and 409', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    let status = 200;
    const { fetch, calls } = fakeFetch({
      'GET /api/bots/b1/computer/screen': () => (status === 200 ? new Response(jpeg, { status, headers: { 'Content-Type': 'image/jpeg' } }) : new Response('', { status })),
    });
    const client = createClient({ baseUrl: BASE, token: 'tok', fetch });
    expect(await client.screen('b1')).toEqual({ kind: 'frame', uri: 'data:image/jpeg;base64,/9j/4A==' });
    expect(headersOf(calls[0]).Authorization).toBe('Bearer tok');
    status = 409;
    expect(await client.screen('b1')).toEqual({ kind: 'stopped' });
    status = 404;
    expect(await client.screen('b1')).toEqual({ kind: 'none' });
  });

  it('posts takeover and input bodies validated by the protocol', async () => {
    const takeover = { botId: 'b1', active: true, requestedBy: 'user', at: T0 };
    const { fetch, calls } = fakeFetch({
      'POST /api/bots/b1/computer/takeover': () => json(takeover),
      'POST /api/bots/b1/computer/input': () => new Response(null, { status: 204 }),
      'GET /api/bots/b1/computer': () => json({ state: 'ready', desktop: true, width: 1280, height: 800, takeover: null }),
    });
    const client = createClient({ baseUrl: BASE, token: 'tok', fetch });
    expect(await client.setTakeover('b1', { active: true })).toMatchObject({ active: true });
    await client.sendInput('b1', { type: 'click', x: 10, y: 20, button: 'left', double: false });
    await expect(client.sendInput('b1', { type: 'key', key: 'Return; rm' })).rejects.toThrow();
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ type: 'click', x: 10, y: 20, button: 'left', double: false });
    expect((await client.getComputer('b1')).state).toBe('ready');
  });

  it('asks for DM threads, sends mentions and accepts a room post with no responder', async () => {
    const { fetch, calls } = fakeFetch({
      'GET /api/bots/b1/threads?kind=dm': () => json([]),
      'POST /api/threads/room1/messages': () => json({ runId: null }, 202),
      'GET /api/tasks?status=open': () => json([]),
    });
    const client = createClient({ baseUrl: BASE, token: 'tok', fetch });
    await client.listThreads('b1', 'dm');
    expect(await client.postMessage('room1', '@Onça hi', ['b2'])).toEqual({ runId: null });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ content: '@Onça hi', mentions: ['b2'] });
    await client.listTasks({ status: 'open' });
    expect(calls[2]?.url).toBe(`${BASE}/api/tasks?status=open`);
  });
});
