import { describe, expect, it } from 'vitest';
import { canPlayAudio, playAudioBlob } from './voicePlayer';
import { DEFAULT_SYSTEM_VOICE, VOICE_TEXT_MAX, silentWavBlob, voiceTextAllowed } from './voice';

describe('voice text rules', () => {
  it('accepts 1..2000 non-blank characters', () => {
    expect(DEFAULT_SYSTEM_VOICE).toBe('Samantha');
    expect(voiceTextAllowed('Hello')).toBe(true);
    expect(voiceTextAllowed('   ')).toBe(false);
    expect(voiceTextAllowed('x'.repeat(VOICE_TEXT_MAX))).toBe(true);
    expect(voiceTextAllowed('x'.repeat(VOICE_TEXT_MAX + 1))).toBe(false);
  });
});

describe('silent wav', () => {
  it('builds a valid 16-bit mono WAV blob', async () => {
    const blob = silentWavBlob();
    expect(blob.type).toBe('audio/wav');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(text(36)).toBe('data');
    expect(bytes.byteLength).toBeGreaterThan(44);
  });
});

describe('audio playback helpers', () => {
  it('reports audio as unsupported in a non-browser test environment', () => {
    expect(canPlayAudio()).toBe(false);
    expect(playAudioBlob(silentWavBlob())).toBeNull();
  });
});
