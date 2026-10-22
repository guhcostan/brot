import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base = { name: 'Voice bot', job: 'Reader', computer: 'none' as const };

describe('mock voice settings', () => {
  it('defaults to the system provider with Samantha and is available', async () => {
    const client = createMockClient();
    const availability = await client.getVoiceSettings();

    expect(availability.available).toBe(true);
    expect(availability.settings).toMatchObject({ provider: 'system', voice: 'Samantha' });
  });

  it('returns a silent WAV from speakText', async () => {
    const client = createMockClient();
    const result = await client.speakText('Hello');
    expect(result.contentType).toBe('audio/wav');
    const header = new Uint8Array(await result.blob.arrayBuffer()).slice(0, 4);
    expect(String.fromCharCode(...header)).toBe('RIFF');
    await expect(client.speakText('   ')).rejects.toThrow();
  });

  it('marks the compatible provider unavailable until it has settings and a saved key', async () => {
    const client = createMockClient();
    await client.updateVoiceSettings({ provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'tts-1', secretName: 'voice_key' });

    const missing = await client.getVoiceSettings();
    expect(missing.available).toBe(false);
    expect(missing.reason).toContain('saved key');
    await expect(client.speakText('Hello')).rejects.toThrow('503');

    await client.setSecret('voice_key', 'sk-test');
    const ready = await client.getVoiceSettings();
    expect(ready.available).toBe(true);
    await expect(client.speakText('Hello')).resolves.toMatchObject({ contentType: 'audio/wav' });
  });

  it('exposes secret names but never values, and saves settings', async () => {
    const client = createMockClient();
    await client.setSecret('openai_key', 'sk-test');
    expect(await client.listSecretNames()).toEqual(['openai_key']);

    const saved = await client.updateVoiceSettings({ provider: 'system', voice: 'Daniel' });
    expect(saved.voice).toBe('Daniel');
    expect((await client.getVoiceSettings()).settings.voice).toBe('Daniel');
  });
});

describe('mock bot speakReplies', () => {
  it('persists the flag through create and update', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, speakReplies: true });
    expect(created.speakReplies).toBe(true);

    const listed = (await client.listBots()).find((bot) => bot.id === created.id);
    expect(listed?.speakReplies).toBe(true);

    const off = await client.updateBot(created.id, { speakReplies: false });
    expect(off.speakReplies).toBeUndefined();
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.speakReplies).toBeUndefined();
  });

  it('leaves the flag off by default', async () => {
    const client = createMockClient();
    const created = await client.createBot(base);
    expect(created.speakReplies).toBeUndefined();
  });
});
