import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, createTestContext, type TestContext } from '../testing';
import type { ProviderSpec } from '../llm';
import { TRANSCRIPTION_SETTINGS_KEY } from './transcribe';

const SPEECH_PROVIDER: ProviderSpec = {
  id: 'speech',
  api: 'openai-completions',
  baseUrl: 'https://speech.example/v1',
  secretName: 'speech',
  models: [{ id: 'whisper-1', transcription: true }, { id: 'chat-only' }],
};

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ llm: { providers: [SPEECH_PROVIDER] } });
});

afterEach(async () => {
  await ctx.close();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('GET/PUT /api/transcription', () => {
  it('starts unconfigured and unavailable with the reason', async () => {
    const body = await json<{ settings: Record<string, unknown>; available: boolean; reason?: string }>(
      await call(ctx.app, 'GET', '/api/transcription'),
    );
    expect(body.settings).toEqual({});
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/no transcription model is configured/);
  });

  it('saves a transcription-capable model, then reports availability from the vault', async () => {
    const saved = await call(ctx.app, 'PUT', '/api/transcription', { model: 'speech/whisper-1' });
    expect(saved.status).toBe(200);
    expect(await json(saved)).toMatchObject({ model: 'speech/whisper-1', updatedAt: expect.any(String) });
    expect(await ctx.services.repos.settings.get(TRANSCRIPTION_SETTINGS_KEY, (await import('./transcribe')).TranscriptionSettings)).toMatchObject({
      model: 'speech/whisper-1',
    });

    // The model resolves but its provider secret is not stored yet.
    const missingKey = await json<{ available: boolean; reason?: string }>(await call(ctx.app, 'GET', '/api/transcription'));
    expect(missingKey.available).toBe(false);
    expect(missingKey.reason).toMatch(/Add a "speech" secret/);

    await ctx.services.vault.set('speech', 'sk-speech-test');
    const available = await json<{ available: boolean; settings: { model?: string } }>(
      await call(ctx.app, 'GET', '/api/transcription'),
    );
    expect(available.available).toBe(true);
    expect(available.settings.model).toBe('speech/whisper-1');
  });

  it('rejects a model that cannot transcribe, and clears the setting with null', async () => {
    for (const model of ['speech/chat-only', 'ghost/model', 'speech/missing', 'not-a-ref']) {
      const res = await call(ctx.app, 'PUT', '/api/transcription', { model });
      expect(res.status, model).toBe(400);
      const body = await json<{ issues: Array<{ path: string[]; message: string }> }>(res);
      expect(body.issues[0]?.path).toEqual(['model']);
    }
    await call(ctx.app, 'PUT', '/api/transcription', { model: 'speech/whisper-1' });
    const cleared = await call(ctx.app, 'PUT', '/api/transcription', { model: null });
    expect(cleared.status).toBe(200);
    expect(await json<{ settings: { model?: string } }>(await call(ctx.app, 'GET', '/api/transcription'))).toMatchObject({
      settings: {},
    });
  });

  it('needs a paired device for a remote caller', async () => {
    expect((await ctx.remote.request('/api/transcription')).status).toBe(401);
    expect(
      (
        await ctx.remote.request('/api/transcription', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'speech/whisper-1' }),
        })
      ).status,
    ).toBe(401);
  });
});
