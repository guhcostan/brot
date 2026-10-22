import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoiceSettings } from '@brot/protocol';
import { createApp } from '../app';
import { call, createTestContext, type TestContext } from '../testing';
import type { VoiceFetch, VoiceOptions } from './speak';
import { VOICE_SETTINGS_KEY } from './settings';
import type { SpeechRunner } from './spawn';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
});

afterEach(async () => {
  await ctx.close();
});

function appWith(voice: VoiceOptions): ReturnType<typeof createApp> {
  return createApp({
    ...ctx.services,
    config: { host: '127.0.0.1', port: 8799, mode: 'server' },
    trustLoopback: true,
    voice,
  });
}

function fakeSystemRunner(): SpeechRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(argv) {
      calls.push(argv);
      const target = argv[0] === 'afconvert' ? argv.at(-1) : argv[argv.indexOf('-o') + 1];
      if (target !== undefined) await writeFile(target, argv[0] === 'afconvert' ? 'WAV' : 'AIFF');
      return { code: 0, stderr: '' };
    },
  };
}

const darwin = { platform: 'darwin' as const, hasBinary: async (name: string) => name === 'say' };

describe('GET /api/voice', () => {
  it('returns the defaults and the availability reason outside macOS', async () => {
    const app = appWith({ platform: 'linux' });
    const res = await call(app, 'GET', '/api/voice');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      settings: { provider: 'system', voice: '', secretName: 'tts' },
      available: false,
      reason: expect.stringMatching(/macOS/),
    });
    expect(text).not.toContain('sk-');
  });

  it('reports the system provider as available with the say command', async () => {
    const app = appWith(darwin);
    expect(await (await call(app, 'GET', '/api/voice')).json()).toEqual({
      settings: { provider: 'system', voice: '', secretName: 'tts' },
      available: true,
    });
  });
});

describe('PUT /api/voice', () => {
  it('saves the system settings and reflects them on GET', async () => {
    const app = appWith(darwin);
    const put = await call(app, 'PUT', '/api/voice', { provider: 'system', voice: 'Samantha' });
    expect(put.status).toBe(200);
    const saved = (await put.json()) as VoiceSettings;
    expect(saved).toMatchObject({ provider: 'system', voice: 'Samantha', secretName: 'tts' });
    expect(saved.updatedAt).toEqual(expect.any(String));
    expect(await ctx.services.repos.settings.get(VOICE_SETTINGS_KEY, VoiceSettings)).toEqual(saved);

    const got = (await (await call(app, 'GET', '/api/voice')).json()) as { settings: VoiceSettings };
    expect(got.settings).toEqual(saved);
  });

  it('saves an openai-compatible server without its key and reports availability from the vault', async () => {
    const app = appWith({ platform: 'linux' });
    const put = await call(app, 'PUT', '/api/voice', {
      provider: 'openai-compatible',
      baseUrl: 'https://tts.example.com/v1',
      model: 'tts-1',
      voice: 'alloy',
      secretName: 'tts',
    });
    expect(put.status).toBe(200);

    const withoutKey = (await (await call(app, 'GET', '/api/voice')).json()) as {
      available: boolean;
      reason: string;
    };
    expect(withoutKey.available).toBe(false);
    expect(withoutKey.reason).toMatch(/"tts" secret/);

    await ctx.services.vault.set('tts', 'sk-secret-value');
    const withKey = await call(app, 'GET', '/api/voice');
    const text = await withKey.text();
    expect(JSON.parse(text)).toMatchObject({
      settings: { provider: 'openai-compatible', secretName: 'tts' },
      available: true,
    });
    expect(text).not.toContain('sk-secret-value');
  });

  it('rejects an incomplete server config, an empty voice and a non-JSON write', async () => {
    const app = appWith(darwin);
    const incomplete = await call(app, 'PUT', '/api/voice', { provider: 'openai-compatible' });
    expect(incomplete.status).toBe(400);
    const issues = ((await incomplete.json()) as { issues: { path: string[] }[] }).issues;
    expect(issues.map((issue) => issue.path[0])).toEqual(expect.arrayContaining(['baseUrl', 'model']));

    expect((await call(app, 'PUT', '/api/voice', { provider: 'system', voice: '' })).status).toBe(400);
    const noContentType = await app.request('/api/voice', { method: 'PUT', body: '{}' });
    expect(noContentType.status).toBe(415);
  });
});

describe('POST /api/voice/speak', () => {
  it('returns WAV audio from the system provider with no-store', async () => {
    const runner = fakeSystemRunner();
    const app = appWith({ ...darwin, hasBinary: async () => true, run: runner });
    const res = await call(app, 'POST', '/api/voice/speak', { text: 'Hello there' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('WAV');
    expect(runner.calls).toHaveLength(2);
  });

  it('returns the AIFF when afconvert is missing', async () => {
    const runner = fakeSystemRunner();
    const app = appWith({ ...darwin, run: runner });
    const res = await call(app, 'POST', '/api/voice/speak', { text: 'Hello' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/aiff');
    expect(await res.text()).toBe('AIFF');
  });

  it('returns MP3 audio from an openai-compatible server', async () => {
    await call(appWith(darwin), 'PUT', '/api/voice', {
      provider: 'openai-compatible',
      baseUrl: 'https://tts.example.com/v1',
      model: 'tts-1',
      voice: 'alloy',
      secretName: 'tts',
    });
    await ctx.services.vault.set('tts', 'sk-secret-value');
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImpl: VoiceFetch = async (url, init) => {
      requests.push({ url, init });
      return new Response(new Uint8Array([0xff, 0xfb]), { status: 200 });
    };
    const app = appWith({ fetch: fetchImpl, platform: 'linux' });

    const res = await call(app, 'POST', '/api/voice/speak', { text: 'Hello' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xfb]));
    expect(requests[0]?.url.toString()).toBe('https://tts.example.com/v1/audio/speech');
    expect(requests[0]?.init.headers).toMatchObject({ authorization: 'Bearer sk-secret-value' });
  });

  it('answers 400 for invalid text', async () => {
    const app = appWith(darwin);
    expect((await call(app, 'POST', '/api/voice/speak', { text: '' })).status).toBe(400);
    expect((await call(app, 'POST', '/api/voice/speak', { text: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('answers 503 with a plain reason when speech is unavailable', async () => {
    const offMac = await call(appWith({ platform: 'linux' }), 'POST', '/api/voice/speak', { text: 'Hello' });
    expect(offMac.status).toBe(503);
    expect(((await offMac.json()) as { error: string }).error).toMatch(/macOS/);

    await call(appWith(darwin), 'PUT', '/api/voice', {
      provider: 'openai-compatible',
      baseUrl: 'https://tts.example.com/v1',
      model: 'tts-1',
      secretName: 'tts',
    });
    const noKey = await call(appWith({ platform: 'linux' }), 'POST', '/api/voice/speak', { text: 'Hello' });
    expect(noKey.status).toBe(503);
    const text = await noKey.text();
    expect((JSON.parse(text) as { error: string }).error).toMatch(/"tts" secret/);
    expect(text).not.toContain('sk-');
  });

  it('answers 503 when the speech server fails, never echoing the key', async () => {
    await call(appWith(darwin), 'PUT', '/api/voice', {
      provider: 'openai-compatible',
      baseUrl: 'https://tts.example.com/v1',
      model: 'tts-1',
      secretName: 'tts',
    });
    await ctx.services.vault.set('tts', 'sk-secret-value');
    const app = appWith({
      platform: 'linux',
      fetch: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    const res = await call(app, 'POST', '/api/voice/speak', { text: 'Hello' });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toMatch(/could not be reached/);
    expect(text).not.toContain('sk-secret-value');
  });

  it('requires device auth from a remote caller', async () => {
    expect((await ctx.remote.request('/api/voice')).status).toBe(401);
    const remoteSpeak = await ctx.remote.request('/api/voice/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });
    expect(remoteSpeak.status).toBe(401);
  });
});
