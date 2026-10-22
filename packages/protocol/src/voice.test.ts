import { describe, expect, it } from 'vitest';
import {
  VoiceInfo,
  VoiceProvider,
  VoiceSettings,
  VoiceSpeakRequest,
  UpdateVoiceSettings,
} from './voice';

const at = '2026-10-22T18:00:00.000Z';

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

const system = { provider: 'system' as const, voice: 'Samantha', secretName: 'tts', updatedAt: at };
const server = {
  provider: 'openai-compatible' as const,
  voice: 'alloy',
  model: 'tts-1',
  baseUrl: 'https://tts.example.com/v1',
  secretName: 'tts-key',
  updatedAt: at,
};

describe('VoiceSettings', () => {
  it('round-trips system and openai-compatible settings through JSON', () => {
    expect(roundTrip(VoiceSettings, system)).toEqual(system);
    expect(roundTrip(VoiceSettings, server)).toEqual(server);
    expect(VoiceProvider.options).toEqual(['system', 'openai-compatible']);
  });

  it('defaults the secret name to tts and leaves updatedAt optional', () => {
    expect(VoiceSettings.parse({ provider: 'system', voice: '' })).toEqual({
      provider: 'system',
      voice: '',
      secretName: 'tts',
    });
    expect(() => VoiceSettings.parse({ provider: 'system' })).toThrow();
    expect(() => VoiceSettings.parse({ provider: 'system', voice: 'x'.repeat(81) })).toThrow();
  });

  it('requires a baseUrl and model for an openai-compatible provider', () => {
    expect(() => VoiceSettings.parse({ provider: 'openai-compatible', voice: 'alloy' })).toThrow();
    const problems = VoiceSettings.safeParse({ provider: 'openai-compatible', voice: 'alloy' });
    expect(problems.success ? [] : problems.error.issues.map((issue) => issue.path[0])).toEqual(['baseUrl', 'model']);
    expect(VoiceSettings.parse({ provider: 'openai-compatible', voice: 'alloy', baseUrl: 'https://x.test/v1', model: 'tts-1' })).toMatchObject({
      baseUrl: 'https://x.test/v1',
      model: 'tts-1',
    });
  });

  it('accepts https anywhere and http only on loopback, without credentials, query or fragment', () => {
    for (const baseUrl of ['https://tts.example.com/v1', 'http://localhost:8880/v1', 'http://127.0.0.1:8880', 'http://[::1]:8880']) {
      expect(VoiceSettings.parse({ provider: 'openai-compatible', voice: 'v', model: 'm', baseUrl }).baseUrl).toBe(baseUrl);
    }
    for (const baseUrl of [
      'http://tts.example.com/v1',
      'https://user:key@tts.example.com/v1',
      'https://tts.example.com/v1?key=1',
      'https://tts.example.com/v1#frag',
      'ftp://tts.example.com/v1',
      'not a url',
    ]) {
      expect(() => VoiceSettings.parse({ provider: 'openai-compatible', voice: 'v', model: 'm', baseUrl })).toThrow(/baseUrl|URL/);
    }
  });

  it('validates the secret name with the vault pattern', () => {
    expect(VoiceSettings.parse({ provider: 'system', voice: '', secretName: 'api.key-1_x' }).secretName).toBe('api.key-1_x');
    for (const secretName of ['-bad', 'has space', 'a'.repeat(129), '']) {
      expect(() => VoiceSettings.parse({ provider: 'system', voice: '', secretName })).toThrow();
    }
  });
});

describe('UpdateVoiceSettings', () => {
  it('requires a provider and keeps the other fields optional', () => {
    expect(UpdateVoiceSettings.parse({ provider: 'system' })).toEqual({ provider: 'system' });
    expect(UpdateVoiceSettings.parse({ provider: 'system', voice: 'Daniel', secretName: 'voice-key' })).toEqual({
      provider: 'system',
      voice: 'Daniel',
      secretName: 'voice-key',
    });
    expect(() => UpdateVoiceSettings.parse({})).toThrow();
    expect(() => UpdateVoiceSettings.parse({ provider: 'system', voice: '' })).toThrow();
    expect(() => UpdateVoiceSettings.parse({ provider: 'system', voice: 'x'.repeat(81) })).toThrow();
    expect(() => UpdateVoiceSettings.parse({ provider: 'system', model: 'x'.repeat(121) })).toThrow();
  });

  it('requires baseUrl and model when switching to an openai-compatible server', () => {
    expect(() => UpdateVoiceSettings.parse({ provider: 'openai-compatible', voice: 'alloy' })).toThrow();
    expect(
      UpdateVoiceSettings.parse({ provider: 'openai-compatible', baseUrl: 'https://tts.example.com/v1', model: 'tts-1' }),
    ).toMatchObject({ provider: 'openai-compatible', model: 'tts-1' });
  });
});

describe('speech requests and info', () => {
  it('requires 1 to 2000 characters of text', () => {
    expect(VoiceSpeakRequest.parse({ text: 'Hello there.' })).toEqual({ text: 'Hello there.' });
    expect(() => VoiceSpeakRequest.parse({ text: '' })).toThrow();
    expect(() => VoiceSpeakRequest.parse({ text: 'x'.repeat(2001) })).toThrow();
    expect(VoiceSpeakRequest.parse({ text: 'x'.repeat(2000) }).text).toHaveLength(2000);
  });

  it('describes availability with an optional reason', () => {
    expect(VoiceInfo.parse({ settings: system, available: true })).toEqual({ settings: system, available: true });
    expect(VoiceInfo.parse({ settings: system, available: false, reason: 'No voice.' })).toMatchObject({
      available: false,
      reason: 'No voice.',
    });
  });
});
