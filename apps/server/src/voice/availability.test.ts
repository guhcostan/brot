import { describe, expect, it } from 'vitest';
import type { VoiceSettings } from '@brot/protocol';
import type { Vault } from '../vault';
import { voiceAvailability } from './availability';

const system: VoiceSettings = { provider: 'system', voice: '', secretName: 'tts' };
const server: VoiceSettings = {
  provider: 'openai-compatible',
  voice: 'alloy',
  model: 'tts-1',
  baseUrl: 'https://tts.example.com/v1',
  secretName: 'voice-key',
};

function vaultWith(secrets: string[]): Pick<Vault, 'has'> {
  return { async has(name) { return secrets.includes(name); } };
}

describe('voiceAvailability', () => {
  it('reports the system provider unavailable off macOS', async () => {
    expect(await voiceAvailability(system, { vault: vaultWith([]), platform: 'linux' })).toEqual({
      available: false,
      reason: expect.stringMatching(/macOS/),
    });
  });

  it('reports the system provider unavailable when say is missing', async () => {
    expect(
      await voiceAvailability(system, { vault: vaultWith([]), platform: 'darwin', hasBinary: async () => false }),
    ).toEqual({ available: false, reason: expect.stringMatching(/"say"/) });
  });

  it('reports the system provider available on macOS with say', async () => {
    expect(
      await voiceAvailability(system, { vault: vaultWith([]), platform: 'darwin', hasBinary: async () => true }),
    ).toEqual({ available: true });
  });

  it('reports a configured server without its key as unavailable', async () => {
    expect(await voiceAvailability(server, { vault: vaultWith([]) })).toEqual({
      available: false,
      reason: expect.stringMatching(/"voice-key" secret/),
    });
  });

  it('reports a configured server with its key as available, without reading the key', async () => {
    expect(await voiceAvailability(server, { vault: vaultWith(['voice-key']) })).toEqual({ available: true });
  });

  it('reports an incomplete server configuration as unavailable', async () => {
    const incomplete: VoiceSettings = { provider: 'openai-compatible', voice: '', secretName: 'tts' };
    expect(await voiceAvailability(incomplete, { vault: vaultWith(['tts']) })).toEqual({
      available: false,
      reason: expect.stringMatching(/base URL and a model/),
    });
  });
});
