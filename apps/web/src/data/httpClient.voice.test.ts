import type { Bot } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const settings = {
  provider: 'system' as const,
  voice: 'Samantha',
  secretName: 'tts',
  updatedAt: at,
};

const availability = { settings, available: true };

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: false,
  archived: false,
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

describe('voice settings routes', () => {
  it('reads the settings and availability', async () => {
    const { fetch, calls } = fakeFetch(() => json(availability));
    const client = createHttpClient({ fetch });

    await expect(client.getVoiceSettings()).resolves.toEqual(availability);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/voice' });
  });

  it('puts the provider and compatible fields', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...settings, provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'tts-1', secretName: 'openai_key' }));
    const client = createHttpClient({ fetch });

    await client.updateVoiceSettings({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'tts-1', secretName: 'openai_key' });
    await client.updateVoiceSettings({ provider: 'system', voice: 'Samantha' });

    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/voice' });
    expect(calls[0]?.body).toEqual({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'tts-1', secretName: 'openai_key' });
    expect(calls[1]?.body).toEqual({ provider: 'system', voice: 'Samantha' });
  });

  it('rejects malformed settings from the server', async () => {
    const malformed = createHttpClient({ fetch: fakeFetch(() => json({ settings: {}, available: 'yes' })).fetch });
    await expect(malformed.getVoiceSettings()).rejects.toThrow();
  });
});

describe('speak route', () => {
  it('returns the audio blob and content type', async () => {
    const { fetch, calls } = fakeFetch(
      () => new Response(new Blob(['RIFF'], { type: 'audio/wav' }), { status: 200, headers: { 'Content-Type': 'audio/wav' } }),
    );
    const client = createHttpClient({ fetch });

    const result = await client.speakText('Hello there');
    expect(result.contentType).toBe('audio/wav');
    expect(result.blob).toBeInstanceOf(Blob);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/voice/speak', body: { text: 'Hello there' } });
  });

  it('rejects blank/oversized text before any request and surfaces 400/503', async () => {
    const { fetch, calls } = fakeFetch(() => json(availability));
    const client = createHttpClient({ fetch });

    await expect(client.speakText('  ')).rejects.toThrow();
    await expect(client.speakText('x'.repeat(2001))).rejects.toThrow();
    expect(calls).toHaveLength(0);

    const invalid = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Invalid request', issues: [{ path: ['text'], message: 'too long' }] }, 400)).fetch });
    await expect(invalid.speakText('Hello')).rejects.toThrow('400 Invalid request: too long');

    const unavailable = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Voice is unavailable' }, 503)).fetch });
    await expect(unavailable.speakText('Hello')).rejects.toThrow('503 Voice is unavailable');
  });
});

describe('bot speakReplies payloads', () => {
  it('sends speakReplies on create and update, and reattaches it from responses', async () => {
    const { fetch, calls } = fakeFetch((call) => json({ ...bot, speakReplies: true }, call.method === 'POST' ? 201 : 200));
    const client = createHttpClient({ fetch });

    const created = await client.createBot({ name: 'Capy', job: 'Chief', computer: 'none', speakReplies: true });
    expect(created.speakReplies).toBe(true);
    await client.updateBot('bot_1', { speakReplies: false });

    expect(calls[0]?.body).toMatchObject({ speakReplies: true });
    expect(calls[1]?.body).toEqual({ speakReplies: false });
  });

  it('attaches the flag from the list response and leaves it off when absent', async () => {
    const withFlag = { ...bot, speakReplies: true };
    const { fetch } = fakeFetch(() => json([withFlag, { ...bot, id: 'bot_2', name: 'Onça' }]));
    const client = createHttpClient({ fetch });

    const bots = await client.listBots();
    expect(bots.map((entry) => entry.speakReplies)).toEqual([true, undefined]);
  });
});
