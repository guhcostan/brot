import { describe, expect, it } from 'vitest';
import { ApiError, completePairing, createClient } from './client';
import { approval, bot, fakeFetch, headersOf, json, T0 } from '../testing';

const BASE = 'http://192.168.1.20:8799/';

describe('createClient', () => {
  it('sends the device token as a bearer token and validates the reply', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /api/bots': () => json([bot({ id: 'b1' })]) });
    const client = createClient({ baseUrl: BASE, token: 'tok', fetch });
    const bots = await client.listBots();
    expect(bots.map((b) => b.id)).toEqual(['b1']);
    expect(calls[0]?.url).toBe('http://192.168.1.20:8799/api/bots');
    expect(headersOf(calls[0]).Authorization).toBe('Bearer tok');
  });

  it('rejects replies that do not match the protocol', async () => {
    const { fetch } = fakeFetch({ 'GET /api/bots': () => json([{ id: 'b1' }]) });
    const client = createClient({ baseUrl: BASE, token: 'tok', fetch });
    await expect(client.listBots()).rejects.toThrow(/unexpected shape/);
  });

  it('surfaces the server error message and status', async () => {
    const { fetch } = fakeFetch({ 'GET /api/bots': () => json({ error: 'Invalid device token' }, 401) });
    const error = await createClient({ baseUrl: BASE, token: 'bad', fetch })
      .listBots()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).unauthorized).toBe(true);
    expect((error as ApiError).message).toContain('Invalid device token');
  });

  it('reports network failures as status 0', async () => {
    const client = createClient({
      baseUrl: BASE,
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
    });
    await expect(client.health()).rejects.toMatchObject({ status: 0 });
  });

  it('posts JSON writes with the content type the server requires', async () => {
    const resolved = approval({ id: 'a 1', status: 'allowed', decision: 'allow_once', resolvedAt: T0 });
    const { fetch, calls } = fakeFetch({ 'POST /api/approvals/a%201': () => json(resolved) });
    const client = createClient({ baseUrl: BASE, token: 'tok', fetch });
    const result = await client.resolveApproval('a 1', 'allow_once', 'thanks');
    expect(result.status).toBe('allowed');
    const init = calls[0]?.init;
    expect(headersOf({ init })['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ decision: 'allow_once', reply: 'thanks' });
  });

  it('validates outgoing bodies before sending', async () => {
    const { fetch, calls } = fakeFetch({});
    const client = createClient({ baseUrl: BASE, token: 'tok', fetch });
    await expect(client.postMessage('th1', '')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('filters approvals by status', async () => {
    const { fetch, calls } = fakeFetch({ 'GET /api/approvals?status=pending': () => json([approval({ id: 'a1' })]) });
    await createClient({ baseUrl: BASE, token: 'tok', fetch }).listApprovals('pending');
    expect(calls[0]?.url).toBe('http://192.168.1.20:8799/api/approvals?status=pending');
  });

  it('builds the event stream request with auth headers and a resume cursor', () => {
    const client = createClient({ baseUrl: BASE, token: 'tok' });
    const stream = client.eventStream({ after: T0 });
    expect(stream.url).toBe(`http://192.168.1.20:8799/api/events?after=${encodeURIComponent(T0)}`);
    expect(stream.headers).toEqual({ Accept: 'text/event-stream', Authorization: 'Bearer tok' });
  });

  it('sends DELETE for device removal and accepts an empty 204', async () => {
    const { fetch, calls } = fakeFetch({ 'DELETE /api/devices/d1': () => new Response(null, { status: 204 }) });
    await createClient({ baseUrl: BASE, token: 'tok', fetch }).removeDevice('d1');
    expect(calls[0]?.init?.method).toBe('DELETE');
  });
});

describe('completePairing', () => {
  it('sends no token and returns the device credentials', async () => {
    const { fetch, calls } = fakeFetch({
      'POST /api/pairing/complete': () => json({ deviceId: 'd1', deviceToken: 'secret' }, 201),
    });
    const result = await completePairing(BASE, { token: 'p', code: '654321', deviceName: 'Phone', publicKey: 'pk', role: 'approver' }, fetch);
    expect(result).toEqual({ deviceId: 'd1', deviceToken: 'secret' });
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ role: 'approver', publicKey: 'pk', code: '654321' });
  });

  it('maps an expired token to a 401 ApiError', async () => {
    const { fetch } = fakeFetch({
      'POST /api/pairing/complete': () => json({ error: 'Pairing token is invalid or expired' }, 401),
    });
    await expect(
      completePairing(BASE, { token: 'p', code: '654321', deviceName: 'Phone', publicKey: 'pk', role: 'full' }, fetch),
    ).rejects.toMatchObject({ status: 401 });
  });
});
