import type { Bot } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { ScreenUnavailable } from './client';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Boto',
  job: 'Web operator',
  instructions: '',
  engine: 'dsh',
  model: 'opencode-go/deepseek-v4.1-flash',
  computer: 'sandbox',
  desktop: true,
  egress: { mode: 'allowlist', allow: ['duckduckgo.com'] },
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('bot management', () => {
  it('asks for archived bots only when told to', async () => {
    const { fetch, calls } = fakeFetch(() => json([bot]));
    const client = createHttpClient({ fetch });
    await client.listBots({ includeArchived: true });
    await client.listBots();
    expect(calls.map((call) => `${call.path}${call.search}`)).toEqual(['/api/bots?includeArchived=true', '/api/bots']);
  });

  it('creates a bot with a validated body and the default egress policy', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot, 201));
    const client = createHttpClient({ fetch });
    const created = await client.createBot({ name: 'Boto', job: 'Web operator', computer: 'sandbox', desktop: true, engine: 'dsh', model: 'opencode-go/deepseek-v4.1-flash' });
    expect(created.id).toBe('bot_1');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/bots' });
    expect(calls[0]?.body).toMatchObject({ name: 'Boto', desktop: true, egress: { mode: 'deny', allow: [] } });
  });

  it('refuses an invalid egress host before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(bot));
    const client = createHttpClient({ fetch });
    await expect(client.createBot({ name: 'B', job: 'J', egress: { mode: 'allowlist', allow: ['https://x.com/a'] } })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('patches and deletes a bot', async () => {
    const { fetch, calls } = fakeFetch((call) => (call.method === 'DELETE' ? new Response(null, { status: 204 }) : json({ ...bot, archived: true })));
    const client = createHttpClient({ fetch });
    expect((await client.updateBot('bot_1', { archived: true, teamBudgetUsd: null })).archived).toBe(true);
    await client.deleteBot('bot_1');
    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ['PATCH', '/api/bots/bot_1'],
      ['DELETE', '/api/bots/bot_1'],
    ]);
    expect(calls[0]?.body).toEqual({ archived: true, teamBudgetUsd: null });
  });

  it('changes room members and returns the ids', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json([
        { threadId: 'room_1', botId: 'bot_1', joinedAt: at },
        { threadId: 'room_1', botId: 'bot_2', joinedAt: at },
      ]),
    );
    const client = createHttpClient({ fetch });
    expect(await client.updateRoomMembers('room_1', { add: ['bot_2'] })).toEqual(['bot_1', 'bot_2']);
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/rooms/room_1/members', body: { add: ['bot_2'] } });
  });
});

describe('settings routes', () => {
  it('reads providers and stores a key without reading it back', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.method === 'PUT'
        ? json({ name: 'DEEPSEEK_API_KEY' })
        : json([{ id: 'deepseek', label: 'DeepSeek', models: [{ id: 'deepseek/v4', label: 'V4' }], configured: false, secretName: 'DEEPSEEK_API_KEY' }]),
    );
    const client = createHttpClient({ fetch });
    const [provider] = await client.listProviders();
    expect(provider).toEqual({ id: 'deepseek', label: 'DeepSeek', models: [{ id: 'deepseek/v4', label: 'V4' }], configured: false, secretName: 'DEEPSEEK_API_KEY' });
    await client.setSecret('DEEPSEEK_API_KEY', 'sk-test');
    expect(calls[1]).toMatchObject({ method: 'PUT', path: '/api/secrets/DEEPSEEK_API_KEY', body: { value: 'sk-test' } });
  });

  it('rejects a provider list with the wrong shape', async () => {
    const { fetch } = fakeFetch(() => json([{ id: 1 }]));
    await expect(createHttpClient({ fetch }).listProviders()).rejects.toThrow();
  });

  it('starts pairing and lists devices', async () => {
    const { fetch } = fakeFetch((call) =>
      call.path === '/api/pairing/start'
        ? json({ token: 't', code: '123456', expiresAt: at, qrPayload: 'brot://pair?t' }, 201)
        : json([{ id: 'dev_1', name: 'Phone', role: 'full', publicKey: 'k', createdAt: at }]),
    );
    const client = createHttpClient({ fetch });
    expect((await client.startPairing()).code).toBe('123456');
    expect((await client.listDevices())[0]?.name).toBe('Phone');
  });
});

describe('computer routes', () => {
  it('reads the computer and fills a missing size with the desktop default', async () => {
    const { fetch } = fakeFetch(() => json({ state: 'ready', desktop: true, takeover: null }));
    const info = await createHttpClient({ fetch }).getComputer('bot_1');
    expect(info).toEqual({ state: 'ready', desktop: true, width: 1280, height: 800, takeover: null });
  });

  it('turns 404 and 409 from the screen into ScreenUnavailable', async () => {
    for (const status of [404, 409]) {
      const { fetch } = fakeFetch(() => json({ error: 'no' }, status));
      const failure = await createHttpClient({ fetch }).computerScreen('bot_1').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ScreenUnavailable);
      expect((failure as ScreenUnavailable).status).toBe(status);
    }
  });

  it('returns the frame as a blob', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'Content-Type': 'image/jpeg' } }));
    const blob = await createHttpClient({ fetch }).computerScreen('bot_1');
    expect(blob.size).toBe(2);
    expect(calls[0]?.path).toBe('/api/bots/bot_1/computer/screen');
  });

  it('sends validated input and takeover changes', async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.path.endsWith('/takeover') ? json({ botId: 'bot_1', active: true, requestedBy: 'user', at }) : new Response(null, { status: 204 }),
    );
    const client = createHttpClient({ fetch });
    await client.computerInput('bot_1', { type: 'click', x: 10, y: 20, button: 'left', double: false });
    await expect(client.computerInput('bot_1', { type: 'key', key: 'rm -rf' })).rejects.toThrow();
    expect((await client.setTakeover('bot_1', { active: true })).active).toBe(true);
    expect(calls.map((call) => call.path)).toEqual(['/api/bots/bot_1/computer/input', '/api/bots/bot_1/computer/takeover']);
  });
});
