import { describe, expect, it } from 'vitest';
import { createHttpClient, parseBotPreset, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const preset = {
  id: 'preset_1',
  name: 'Support triage',
  job: 'Sort support mail.',
  instructions: 'Be kind.',
  avatar: 'capivara:violet',
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

describe('bot preset routes', () => {
  it('lists presets', async () => {
    const { fetch, calls } = fakeFetch(() => json([preset]));
    const client = createHttpClient({ fetch });

    await expect(client.listBotPresets()).resolves.toEqual([preset]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/presets' });
  });

  it('creates a preset with trimmed name and job', async () => {
    const { fetch, calls } = fakeFetch(() => json(preset, 201));
    const client = createHttpClient({ fetch });

    await expect(
      client.createBotPreset({ name: 'Support triage', job: 'Sort support mail.', instructions: 'Be kind.', avatar: 'capivara:violet' }),
    ).resolves.toEqual(preset);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/presets' });
    expect(calls[0]?.body).toEqual({
      name: 'Support triage',
      job: 'Sort support mail.',
      instructions: 'Be kind.',
      avatar: 'capivara:violet',
    });
  });

  it('patches only supplied preset fields and deletes', async () => {
    const { fetch, calls } = fakeFetch((call) => (call.method === 'PATCH' ? json({ ...preset, job: 'Draft replies.' }) : new Response(null, { status: 204 })));
    const client = createHttpClient({ fetch });

    await expect(client.updateBotPreset('preset_1', { job: 'Draft replies.' })).resolves.toMatchObject({ job: 'Draft replies.' });
    await expect(client.deleteBotPreset('preset_1')).resolves.toBeUndefined();

    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/presets/preset_1', body: { job: 'Draft replies.' } });
    expect(calls[1]).toMatchObject({ method: 'DELETE', path: '/api/presets/preset_1' });
  });

  it('copies a bot into a preset, optionally renaming it', async () => {
    const { fetch, calls } = fakeFetch(() => json(preset, 201));
    const client = createHttpClient({ fetch });

    await client.createPresetFromBot('bot_1');
    await client.createPresetFromBot('bot_1', { name: 'Renamed' });

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/presets/from-bot/bot_1', body: {} });
    expect(calls[1]?.body).toEqual({ name: 'Renamed' });
  });

  it('rejects a blank name or job before sending', async () => {
    const { fetch, calls } = fakeFetch(() => json(preset, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createBotPreset({ name: '', job: 'Jobs.' })).rejects.toThrow();
    await expect(client.createBotPreset({ name: 'Name', job: '' })).rejects.toThrow();
    await expect(client.updateBotPreset('preset_1', { name: '' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('surfaces 400 issues and 404s', async () => {
    const refused = createHttpClient({
      fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['name'], message: 'name is required' }] }, 400)).fetch,
    });
    await expect(refused.createBotPreset({ name: 'Name', job: 'Job' })).rejects.toThrow('400 Invalid request: name is required');

    const missing = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Bot preset not found' }, 404)).fetch });
    await expect(missing.updateBotPreset('nope', { name: 'Name' })).rejects.toThrow('404 Bot preset not found');
    await expect(missing.deleteBotPreset('nope')).rejects.toThrow('404 Bot preset not found');
    await expect(missing.createPresetFromBot('nope')).rejects.toThrow('404 Bot preset not found');
  });

  it('validates the preset shape it reads', () => {
    expect(() => parseBotPreset(null)).toThrow();
    expect(() => parseBotPreset({ id: 'p1', name: 'Only a name' })).toThrow();
    expect(parseBotPreset(preset)).toEqual(preset);
  });
});
