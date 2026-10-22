import { describe, expect, it } from 'vitest';
import { createHttpClient, parseBrowserStatus, type FetchLike } from './httpClient';

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

describe('host browser routes', () => {
  it('reads the status from GET /api/bots/:id/browser', async () => {
    const { fetch, calls } = fakeFetch(() => json({ state: 'running', profile: { kind: 'own' } }));
    const status = await createHttpClient({ fetch }).browserStatus('bot_1');
    expect(status).toEqual({ state: 'running', profile: { kind: 'own' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/bots/bot_1/browser' });
  });

  it('opens the sign-in window and reports the login state', async () => {
    const { fetch, calls } = fakeFetch(() => json({ state: 'login', profile: { kind: 'shared', id: 'profile_1', name: 'Shared accounts' } }, 202));
    await expect(createHttpClient({ fetch }).startBrowserLogin('bot_1')).resolves.toEqual({
      state: 'login',
      profile: { kind: 'shared', id: 'profile_1', name: 'Shared accounts' },
    });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/bots/bot_1/browser/login' });
  });

  it('closes the browser with a 204 and no body', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await expect(createHttpClient({ fetch }).closeBrowser('bot_1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/bots/bot_1/browser/close' });
  });

  it('propagates the 409 of a bot without a host browser', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'This bot has no host browser.' }, 409));
    const client = createHttpClient({ fetch });
    await expect(client.browserStatus('bot_1')).rejects.toThrow('409 This bot has no host browser.');
    await expect(client.startBrowserLogin('bot_1')).rejects.toThrow('409 This bot has no host browser.');
    await expect(client.closeBrowser('bot_1')).rejects.toThrow('409 This bot has no host browser.');
  });

  it('propagates the 404 of an unknown bot', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Bot not found.' }, 404));
    await expect(createHttpClient({ fetch }).browserStatus('missing')).rejects.toThrow('404 Bot not found.');
  });

  it('rejects a state the contract does not define', async () => {
    const { fetch } = fakeFetch(() => json({ state: 'open', profile: { kind: 'own' } }));
    await expect(createHttpClient({ fetch }).browserStatus('bot_1')).rejects.toThrow('Expected browser state');
  });

  it('reads a shared profile reference', async () => {
    const { fetch } = fakeFetch(() =>
      json({ state: 'stopped', profile: { kind: 'shared', id: 'profile_1', name: 'Shared accounts' } }),
    );
    await expect(createHttpClient({ fetch }).browserStatus('bot_1')).resolves.toEqual({
      state: 'stopped',
      profile: { kind: 'shared', id: 'profile_1', name: 'Shared accounts' },
    });
  });

  it('rejects a status without a usable profile reference', async () => {
    const { fetch } = fakeFetch(() => json({ state: 'stopped' }));
    await expect(createHttpClient({ fetch }).browserStatus('bot_1')).rejects.toThrow('Expected a browser profile reference');
  });
});

describe('parseBrowserStatus', () => {
  it('accepts the three states and copies only the known fields', () => {
    expect(parseBrowserStatus({ state: 'stopped', profile: { kind: 'own' }, extra: true })).toEqual({
      state: 'stopped',
      profile: { kind: 'own' },
    });
    expect(parseBrowserStatus({ state: 'running', profile: { kind: 'own' } })).toEqual({
      state: 'running',
      profile: { kind: 'own' },
    });
    expect(parseBrowserStatus({ state: 'login', profile: { kind: 'shared', id: 'p1', name: 'Shared', extra: 1 } })).toEqual({
      state: 'login',
      profile: { kind: 'shared', id: 'p1', name: 'Shared' },
    });
  });

  it('rejects anything else', () => {
    expect(() => parseBrowserStatus(null)).toThrow('Expected a browser status object');
    expect(() => parseBrowserStatus([])).toThrow('Expected a browser status object');
    expect(() => parseBrowserStatus({})).toThrow('Expected browser state');
    expect(() => parseBrowserStatus({ state: 'login' })).toThrow('Expected a browser profile reference');
    expect(() => parseBrowserStatus({ state: 'login', profile: { kind: 'shared', id: 'p1' } })).toThrow('Expected a browser status');
    expect(() => parseBrowserStatus({ state: 'login', profile: { kind: 'team' } })).toThrow('Expected a browser status');
  });
});
