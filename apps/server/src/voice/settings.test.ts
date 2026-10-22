import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoiceSettings } from '@brot/protocol';
import { createTestContext, type TestContext } from '../testing';
import { VOICE_SETTINGS_KEY, getVoiceSettings, saveVoiceSettings } from './settings';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
});

afterEach(async () => {
  await ctx.close();
});

describe('getVoiceSettings', () => {
  it('returns the built-in defaults when nothing is stored', async () => {
    expect(await getVoiceSettings(ctx.services.repos)).toEqual({
      provider: 'system',
      voice: '',
      secretName: 'tts',
    });
  });

  it('falls back to the defaults when the stored value no longer parses', async () => {
    await ctx.services.repos.settings.set(VOICE_SETTINGS_KEY, { provider: 'system' });
    expect(await getVoiceSettings(ctx.services.repos)).toEqual({ provider: 'system', voice: '', secretName: 'tts' });
  });
});

describe('saveVoiceSettings', () => {
  it('merges the update over the defaults, stores it and stamps updatedAt', async () => {
    const saved = await saveVoiceSettings(ctx.services.repos, { provider: 'system', voice: 'Samantha' });
    expect(saved).toMatchObject({ provider: 'system', voice: 'Samantha', secretName: 'tts' });
    expect(saved.updatedAt).toEqual(expect.any(String));

    expect(await ctx.services.repos.settings.get(VOICE_SETTINGS_KEY, VoiceSettings)).toEqual(saved);
    expect(await getVoiceSettings(ctx.services.repos)).toEqual(saved);
  });

  it('keeps the current voice when the provider does not change', async () => {
    await saveVoiceSettings(ctx.services.repos, { provider: 'system', voice: 'Daniel' });
    expect(await saveVoiceSettings(ctx.services.repos, { provider: 'system', secretName: 'voice-key' })).toMatchObject({
      provider: 'system',
      voice: 'Daniel',
      secretName: 'voice-key',
    });
  });

  it('uses the new provider default voice when the provider changes', async () => {
    await saveVoiceSettings(ctx.services.repos, { provider: 'system', voice: 'Daniel' });
    const switched = await saveVoiceSettings(ctx.services.repos, {
      provider: 'openai-compatible',
      baseUrl: 'https://tts.example.com/v1',
      model: 'tts-1',
    });
    expect(switched).toMatchObject({ provider: 'openai-compatible', voice: '', model: 'tts-1' });
  });

  it('stores an openai-compatible server config without the key', async () => {
    await ctx.services.vault.set('tts', 'sk-never-returned');
    const saved = await saveVoiceSettings(ctx.services.repos, {
      provider: 'openai-compatible',
      baseUrl: 'https://tts.example.com/v1',
      model: 'tts-1',
      voice: 'alloy',
      secretName: 'tts',
    });
    expect(saved.secretName).toBe('tts');
    expect(JSON.stringify(saved)).not.toContain('sk-never-returned');
  });
});
