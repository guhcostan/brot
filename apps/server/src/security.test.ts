import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from '@brot/protocol';
import { call, createTestContext, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

describe('cross-site request protection', () => {
  it('refuses state-changing requests that are not application/json', async () => {
    const res = await ctx.app.request('/api/bots', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ name: 'Injected', job: 'x' }),
    });
    expect(res.status).toBe(415);
    expect(await ctx.services.repos.bots.list()).toEqual([]);
  });

  it('refuses writes that declare no content type', async () => {
    const res = await ctx.app.request('/api/runs/anything/cancel', { method: 'POST' });
    expect(res.status).toBe(415);
  });

  it('allows reads without a content type', async () => {
    expect((await ctx.app.request('/api/bots')).status).toBe(200);
  });

  it('answers CORS preflight for the web origins only', async () => {
    const allowed = await ctx.app.request('/api/bots', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5199',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,authorization',
      },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5199');

    const other = await ctx.app.request('/api/bots', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('loopback host check', () => {
  it('rejects a local request whose Host header is not a loopback name', async () => {
    const rebound = await ctx.app.request('/api/bots', { headers: { host: 'evil.example:8799' } });
    expect(rebound.status).toBe(403);

    const local = await ctx.app.request('/api/bots', { headers: { host: '127.0.0.1:8799' } });
    expect(local.status).toBe(200);
  });

  it('does not apply the loopback host check to paired devices', async () => {
    const start = (await (await call(ctx.app, 'POST', '/api/pairing/start')).json()) as {
      token: string;
      code: string;
    };
    const paired = (await (
      await call(ctx.remote, 'POST', '/api/pairing/complete', {
        token: start.token,
        code: start.code,
        deviceName: 'Phone',
        publicKey: 'pk',
        role: 'full',
      })
    ).json()) as { deviceToken: string };

    const res = await ctx.remote.request('/api/bots', {
      headers: { host: 'pair.example.com', authorization: `Bearer ${paired.deviceToken}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Bot[]).length).toBe(0);
  });
});
