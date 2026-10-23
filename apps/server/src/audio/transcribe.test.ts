import { describe, expect, it } from 'vitest';
import type { Repos } from '@brot/db';
import { createProviderRegistry, type ProviderSpec } from '../llm';
import {
  getTranscriptionSettings,
  resolveTranscription,
  saveTranscriptionSettings,
  transcribeAudio,
  transcriptionAvailability,
  type TranscriptionFetch,
} from './transcribe';

/** Settings rows in memory; the shape of `Repos['settings']` the audio module needs. */
class FakeSettings {
  readonly rows = new Map<string, unknown>();
  async get<T>(key: string, schema: { parse(value: unknown): T }): Promise<T | undefined> {
    const value = this.rows.get(key);
    if (value === undefined) return undefined;
    try {
      return schema.parse(value);
    } catch {
      return undefined;
    }
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.rows.set(key, value);
  }
}

const SPEECH_PROVIDER: ProviderSpec = {
  id: 'speech',
  api: 'openai-completions',
  baseUrl: 'https://speech.example/v1',
  secretName: 'speech',
  models: [{ id: 'whisper-1', transcription: true }, { id: 'chat-model' }],
};

const OTHER_API_PROVIDER: ProviderSpec = {
  id: 'claude-audio',
  api: 'anthropic-messages',
  baseUrl: 'https://claude.example/v1',
  secretName: 'claude-audio',
  models: [{ id: 'transcriber', transcription: true }],
};

function deps(options: { key?: string; fetch?: TranscriptionFetch } = {}) {
  const settings = new FakeSettings();
  const repos = { settings } as unknown as Pick<Repos, 'settings'>;
  const vault = {
    has: async (name: string) => (options.key === undefined ? false : name === 'speech' || name === 'claude-audio'),
    resolveRef: async (ref: string) => {
      const name = ref.replace(/^secret:\/\//, '');
      return options.key !== undefined && name === 'speech' ? options.key : undefined;
    },
  };
  const logs: string[] = [];
  return {
    settings,
    repos,
    providers: createProviderRegistry([SPEECH_PROVIDER, OTHER_API_PROVIDER]),
    vault,
    logs,
    deps: { repos, providers: createProviderRegistry([SPEECH_PROVIDER, OTHER_API_PROVIDER]), vault, log: (line: string) => logs.push(line) },
  };
}

const AUDIO_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88]);
const AUDIO = { bytes: AUDIO_BYTES, mimeType: 'audio/webm', filename: 'voice-note.webm' };

async function configure(settings: FakeSettings, model: string | null): Promise<void> {
  const repos = { settings } as unknown as Pick<Repos, 'settings'>;
  await saveTranscriptionSettings(repos, { model });
}

describe('transcription settings', () => {
  it('defaults to unconfigured, saves a model and clears it with null', async () => {
    const { repos } = deps();
    expect(await getTranscriptionSettings(repos)).toEqual({});
    const saved = await saveTranscriptionSettings(repos, { model: 'speech/whisper-1' });
    expect(saved).toMatchObject({ model: 'speech/whisper-1', updatedAt: expect.any(String) });
    expect(await getTranscriptionSettings(repos)).toEqual(saved);
    expect(await saveTranscriptionSettings(repos, { model: null })).toMatchObject({ updatedAt: expect.any(String) });
    expect(await getTranscriptionSettings(repos)).not.toHaveProperty('model');
  });
});

describe('resolveTranscription', () => {
  it('accepts only an openai-completions provider whose model sets transcription: true', async () => {
    const { providers } = deps();
    expect(resolveTranscription(providers, 'speech/whisper-1')).toMatchObject({ ok: true, model: 'whisper-1' });
    expect(resolveTranscription(providers, undefined)).toMatchObject({ ok: false, reason: /no transcription model/ });
    expect(resolveTranscription(providers, 'whisper-1')).toMatchObject({ ok: false, reason: /<provider>\/<model>/ });
    expect(resolveTranscription(providers, 'ghost/model')).toMatchObject({ ok: false, reason: /unknown model provider "ghost"/ });
    expect(resolveTranscription(providers, 'claude-audio/transcriber')).toMatchObject({
      ok: false,
      reason: /does not use the openai-completions API/,
    });
    expect(resolveTranscription(providers, 'speech/missing-model')).toMatchObject({
      ok: false,
      reason: /is not listed by provider "speech"/,
    });
    expect(resolveTranscription(providers, 'speech/chat-model')).toMatchObject({
      ok: false,
      reason: /does not set transcription: true/,
    });
  });
});

describe('transcriptionAvailability', () => {
  it('is available only when the model resolves and the vault holds its secret', async () => {
    const { repos, providers, vault } = deps({ key: 'sk-speech-key' });
    expect(await transcriptionAvailability({ repos, providers, vault })).toMatchObject({ available: false });
    await configure((repos as unknown as { settings: FakeSettings }).settings, 'speech/whisper-1');
    expect(await transcriptionAvailability({ repos, providers, vault })).toEqual({ available: true });

    const noKey = deps();
    await saveTranscriptionSettings(noKey.repos, { model: 'speech/whisper-1' });
    expect(await transcriptionAvailability({ repos: noKey.repos, providers: noKey.providers, vault: noKey.vault })).toMatchObject({
      available: false,
      reason: /Add a "speech" secret/,
    });
  });
});

describe('transcribeAudio', () => {
  it('posts multipart model and file with the bearer key, and returns the trimmed text', async () => {
    const { deps: base, repos, settings } = deps({ key: 'sk-speech-key' });
    await configure(settings, 'speech/whisper-1');
    let captured: { url: string; init: RequestInit } | undefined;
    const fetch: TranscriptionFetch = async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ text: '  hello from the voice note  ' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const transcript = await transcribeAudio({ ...base, repos, fetch }, AUDIO);

    expect(transcript).toBe('hello from the voice note');
    expect(captured?.url).toBe('https://speech.example/v1/audio/transcriptions');
    expect(captured?.init.method).toBe('POST');
    expect((captured?.init.headers as Record<string, string> | undefined)?.authorization).toBe('Bearer sk-speech-key');
    expect(captured?.init.signal).toBeInstanceOf(AbortSignal);
    const form = captured?.init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('response_format')).toBe('json');
    const file = form.get('file') as File;
    expect(file.name).toBe('voice-note.webm');
    expect(file.type).toBe('audio/webm');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(AUDIO_BYTES);
  });

  it('returns undefined and logs only the reason for every failure, never bytes or the key', async () => {
    const { deps: base, repos, settings, logs } = deps({ key: 'sk-super-secret-key' });
    await configure(settings, 'speech/whisper-1');
    const failures: TranscriptionFetch[] = [
      async () => new Response('{"error":"no"}', { status: 500 }),
      async () => new Response('not json', { status: 200 }),
      async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 }),
      async () => {
        throw new Error('ECONNREFUSED');
      },
    ];
    for (const fetch of failures) {
      expect(await transcribeAudio({ ...base, repos, fetch }, AUDIO)).toBeUndefined();
    }
    expect(await transcribeAudio({ ...base, repos, fetch: failures[0]! }, AUDIO)).toBeUndefined();
    const logged = logs.join('\n');
    expect(logged).toMatch(/the provider answered 500/);
    expect(logged).toMatch(/returned no text/);
    expect(logged).toMatch(/request failed/);
    expect(logged).not.toContain('sk-super-secret-key');
    expect(logged).not.toContain(Buffer.from(AUDIO_BYTES).toString('base64'));
    expect(logged).not.toContain('1a45dfa3');
  });

  it('does nothing when no model is configured or the model is not transcription-capable', async () => {
    const { deps: base, repos, settings, logs } = deps({ key: 'sk-speech-key' });
    expect(await transcribeAudio({ ...base, repos }, AUDIO)).toBeUndefined();
    expect(logs.join('\n')).toMatch(/no transcription model is configured/);

    await configure(settings, 'speech/chat-model');
    expect(await transcribeAudio({ ...base, repos }, AUDIO)).toBeUndefined();
    expect(logs.join('\n')).toMatch(/does not set transcription: true/);
  });

  it('does nothing when the vault has no key for the provider', async () => {
    const { deps: base, repos, settings, logs } = deps();
    await configure(settings, 'speech/whisper-1');
    expect(await transcribeAudio({ ...base, repos }, AUDIO)).toBeUndefined();
    expect(logs.join('\n')).toMatch(/the vault has no "speech" secret/);
  });
});
