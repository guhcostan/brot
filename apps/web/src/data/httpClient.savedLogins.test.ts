import type { SavedLogin } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const login: SavedLogin = {
  id: 'login_1',
  name: 'GitHub',
  host: 'github.com',
  label: 'Personal account',
  hasTotp: true,
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

describe('saved login routes', () => {
  it('lists the value-free logins', async () => {
    const { fetch, calls } = fakeFetch(() => json([login]));
    const client = createHttpClient({ fetch });

    await expect(client.listSavedLogins()).resolves.toEqual([login]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/logins' });
  });

  it('creates a login sending only the typed fields', async () => {
    const { fetch, calls } = fakeFetch(() => json(login, 201));
    const client = createHttpClient({ fetch });

    await client.createSavedLogin({ name: 'GitHub', host: 'github.com', username: 'capivara', password: 'secret' });
    await client.createSavedLogin({
      name: 'GitHub',
      host: 'github.com',
      username: 'capivara',
      password: 'secret',
      totp: 'JBSW Y3DP EHPK 3PXP',
      label: 'Personal account',
    });

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/logins' });
    expect(calls[0]?.body).toEqual({ name: 'GitHub', host: 'github.com', username: 'capivara', password: 'secret' });
    expect(calls[1]?.body).toEqual({
      name: 'GitHub',
      host: 'github.com',
      username: 'capivara',
      password: 'secret',
      totp: 'JBSW Y3DP EHPK 3PXP',
      label: 'Personal account',
    });
  });

  it('patches only the changed fields', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...login, hasTotp: false }));
    const client = createHttpClient({ fetch });

    await client.updateSavedLogin('login_1', { name: 'GitHub work' });
    await client.updateSavedLogin('login_1', { label: null, totp: null, username: 'other' });

    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/logins/login_1' });
    expect(calls[0]?.body).toEqual({ name: 'GitHub work' });
    expect(calls[1]?.body).toEqual({ label: null, totp: null, username: 'other' });
  });

  it('deletes a login', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch });

    await expect(client.deleteSavedLogin('login_1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/logins/login_1' });
  });

  it('validates input before any request and surfaces 400/404', async () => {
    const { fetch, calls } = fakeFetch(() => json(login, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createSavedLogin({ name: 'GitHub', host: 'github.com', username: 'u', password: '' })).rejects.toThrow();
    await expect(client.createSavedLogin({ name: 'GitHub', host: 'https://github.com/', username: 'u', password: 'p' })).rejects.toThrow();
    await expect(client.createSavedLogin({ name: 'GitHub', host: 'github.com', username: 'u', password: 'p', totp: 'not-base32!' })).rejects.toThrow();
    expect(calls).toHaveLength(0);

    const duplicate = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['name'], message: 'a saved login with this name already exists' }] }, 400)).fetch,
    });
    await expect(duplicate.createSavedLogin({ name: 'GitHub', host: 'github.com', username: 'u', password: 'p' })).rejects.toThrow(
      '400 Invalid request: a saved login with this name already exists',
    );

    const missing = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Saved login not found' }, 404)).fetch });
    await expect(missing.updateSavedLogin('nope', { name: 'x' })).rejects.toThrow('404 Saved login not found');
    await expect(missing.deleteSavedLogin('nope')).rejects.toThrow('404 Saved login not found');
  });

  it('rejects a response that leaks or malforms the value-free shape', async () => {
    const broken = createHttpClient({ fetch: fakeFetch(() => json([{ ...login, password: 'leaked' }])).fetch });
    // Extra fields are ignored by the protocol object, but a missing required field is refused.
    const missingHost = createHttpClient({ fetch: fakeFetch(() => json([{ id: 'login_1', name: 'GitHub', hasTotp: false, createdAt: at, updatedAt: at }])).fetch });
    await expect(broken.listSavedLogins()).resolves.toHaveLength(1);
    await expect(missingHost.listSavedLogins()).rejects.toThrow();
  });
});
