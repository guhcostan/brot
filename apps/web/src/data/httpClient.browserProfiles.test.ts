import type { CreateBotInput, UpdateBot } from '@brot/protocol';
import type { BrowserProfile } from './client';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const profile: BrowserProfile = {
  id: 'profile_1',
  name: 'Shared accounts',
  createdAt: at,
  updatedAt: at,
};

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

describe('browser profile routes', () => {
  it('lists shared profiles', async () => {
    const { fetch, calls } = fakeFetch(() => json([profile]));
    const client = createHttpClient({ fetch });

    await expect(client.listBrowserProfiles()).resolves.toEqual([profile]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/browser/profiles' });
  });

  it('creates a profile with a trimmed name', async () => {
    const { fetch, calls } = fakeFetch(() => json(profile, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createBrowserProfile({ name: '  Shared accounts  ' })).resolves.toEqual(profile);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/browser/profiles', body: { name: 'Shared accounts' } });
  });

  it('renames a profile and deletes it', async () => {
    const renamed = { ...profile, name: 'Shared logins' };
    const { fetch, calls } = fakeFetch((call) => (call.method === 'PATCH' ? json(renamed) : new Response(null, { status: 204 })));
    const client = createHttpClient({ fetch });

    await expect(client.updateBrowserProfile('profile_1', { name: 'Shared logins' })).resolves.toEqual(renamed);
    await expect(client.deleteBrowserProfile('profile_1')).resolves.toBeUndefined();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'PATCH /api/browser/profiles/profile_1',
      'DELETE /api/browser/profiles/profile_1',
    ]);
    expect(calls[0]?.body).toEqual({ name: 'Shared logins' });
  });

  it('rejects a nameless profile before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(profile, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createBrowserProfile({ name: '   ' })).rejects.toThrow();
    await expect(client.updateBrowserProfile('profile_1', { name: '' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces the 400 and 404 of the profile routes', async () => {
    const { fetch } = fakeFetch((call) =>
      call.method === 'POST' ? json({ error: 'A browser profile needs a name' }, 400) : json({ error: 'Browser profile not found' }, 404),
    );
    const client = createHttpClient({ fetch });

    await expect(client.createBrowserProfile({ name: 'x' })).rejects.toThrow('400 A browser profile needs a name');
    await expect(client.updateBrowserProfile('nope', { name: 'x' })).rejects.toThrow('404 Browser profile not found');
    await expect(client.deleteBrowserProfile('nope')).rejects.toThrow('404 Browser profile not found');
  });

  it('rejects a profile list that does not match the shape', async () => {
    const { fetch } = fakeFetch(() => json([{ id: 'profile_1' }]));
    const client = createHttpClient({ fetch });

    await expect(client.listBrowserProfiles()).rejects.toThrow();
  });
});

describe('bot browser profile payloads', () => {
  it('sends browserProfileId on create and clears it with null on update', async () => {
    const bot = {
      id: 'bot_1',
      name: 'B',
      job: 'J',
      instructions: '',
      engine: 'dsh',
      computer: 'none' as const,
      pinned: false,
      archived: false,
      createdAt: at,
      updatedAt: at,
    };
    const { fetch, calls } = fakeFetch((call) => (call.method === 'POST' ? json(bot, 201) : json(bot)));
    const client = createHttpClient({ fetch });

    const createInput: CreateBotInput = { name: 'B', job: 'J', computer: 'none', browser: true, browserProfileId: 'profile_1' };
    await client.createBot(createInput);
    expect(calls[0]?.body).toMatchObject({ browserProfileId: 'profile_1' });

    const patch: UpdateBot = { browserProfileId: null };
    await client.updateBot('bot_1', patch);
    expect(calls[1]?.body).toEqual({ browserProfileId: null });
  });
});

