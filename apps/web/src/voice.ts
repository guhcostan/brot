import { VoiceSpeakRequest } from '@brot/protocol';
import type { VoiceInfo } from '@brot/protocol';

export type { UpdateVoiceSettings, VoiceInfo, VoiceProvider, VoiceSettings } from '@brot/protocol';

/** The voice the system provider uses unless the person names another macOS voice. */
export const DEFAULT_SYSTEM_VOICE = 'Samantha';

/** The longest text one speak request accepts, matching `VoiceSpeakRequest`. */
export const VOICE_TEXT_MAX = 2000;

/** A short silent WAV (16-bit mono, 8 kHz), for the mock and for tests: a valid playable file. */
export function silentWavBlob(durationMs = 120): Blob {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Whether the text fits one speak request; blank and over-long text is refused before any call. */
export function voiceTextAllowed(text: string): boolean {
  return text.trim() !== '' && VoiceSpeakRequest.safeParse({ text }).success;
}

/** What the transcript and auto-speak need from the app: settings availability and the speak call. */
export interface VoiceContext {
  status: VoiceInfo | null;
  speak: (text: string) => Promise<{ blob: Blob; contentType: string }>;
}
