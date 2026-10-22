import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoiceSettings } from '@brot/protocol';
import type { Vault } from '../vault';
import { binaryAvailable, spawnSpeechRunner, type BinaryCheck, type SpeechRunner } from './spawn';

/** Audio the server can speak. */
export interface SpokenAudio {
  bytes: Uint8Array;
  contentType: 'audio/wav' | 'audio/aiff' | 'audio/mpeg';
}

/** The configured speech cannot be used (wrong platform, missing command or key, upstream failure). */
export class VoiceUnavailableError extends Error {}

/** Outbound HTTP for an openai-compatible server. Tests inject a fake. */
export type VoiceFetch = (url: URL, init: RequestInit) => Promise<Response>;

/** Test seams for the voice providers. Production leaves every one of them unset. */
export interface VoiceOptions {
  run?: SpeechRunner;
  fetch?: VoiceFetch;
  hasBinary?: BinaryCheck;
  platform?: NodeJS.Platform;
}

export interface SpeakDeps extends VoiceOptions {
  vault: Pick<Vault, 'resolveRef'>;
}

const SYSTEM_PLATFORM_MESSAGE = 'System speech is only available on macOS; configure an OpenAI-compatible TTS server instead.';

/**
 * Turns text into speech with the configured provider: the macOS `say` command (plus `afconvert` to WAV, when it
 * exists) or an OpenAI-compatible `/audio/speech` endpoint. The API key comes from the vault at call time, is
 * sent only in the request's Authorization header, and never appears in an error.
 */
export async function speak(text: string, settings: VoiceSettings, deps: SpeakDeps): Promise<SpokenAudio> {
  if (settings.provider === 'system') return speakSystem(text, settings, deps);
  return speakOpenAiCompatible(text, settings, deps);
}

async function speakSystem(text: string, settings: VoiceSettings, deps: SpeakDeps): Promise<SpokenAudio> {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'darwin') throw new VoiceUnavailableError(SYSTEM_PLATFORM_MESSAGE);
  const hasBinary = deps.hasBinary ?? binaryAvailable;
  if (!(await hasBinary('say'))) throw new VoiceUnavailableError('The macOS "say" command is not available.');
  const runner = deps.run ?? spawnSpeechRunner();
  const dir = await mkdtemp(join(tmpdir(), 'brot-voice-'));
  try {
    const aiff = join(dir, 'speech.aiff');
    const wav = join(dir, 'speech.wav');
    const spoken = await runner.run(
      settings.voice === '' ? ['say', '-o', aiff, text] : ['say', '-v', settings.voice, '-o', aiff, text],
    );
    if (spoken.code !== 0) throw new VoiceUnavailableError(systemFailure('say', spoken.stderr));
    const aiffBytes = await readFile(aiff).catch(() => undefined);
    if (aiffBytes === undefined) throw new VoiceUnavailableError('The system speech did not produce audio.');

    if (await hasBinary('afconvert')) {
      const converted = await runner.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@22050', aiff, wav]);
      const wavBytes = converted.code === 0 ? await readFile(wav).catch(() => undefined) : undefined;
      if (wavBytes !== undefined) return { bytes: new Uint8Array(wavBytes), contentType: 'audio/wav' };
    }
    return { bytes: new Uint8Array(aiffBytes), contentType: 'audio/aiff' };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function systemFailure(command: string, stderr: string): string {
  const detail = stderr.trim().split('\n')[0] ?? '';
  return detail === '' ? `The "${command}" command failed.` : `The "${command}" command failed: ${detail}`;
}

async function speakOpenAiCompatible(text: string, settings: VoiceSettings, deps: SpeakDeps): Promise<SpokenAudio> {
  if (settings.baseUrl === undefined || settings.model === undefined) {
    throw new VoiceUnavailableError('The speech provider needs a base URL and a model.');
  }
  const key = await deps.vault.resolveRef(`secret://${settings.secretName}`);
  if (key === undefined) {
    throw new VoiceUnavailableError(`The vault has no "${settings.secretName}" secret for speech.`);
  }
  const url = new URL(`${settings.baseUrl.replace(/\/+$/, '')}/audio/speech`);
  const send = deps.fetch ?? ((input: URL, init: RequestInit) => fetch(input, init));
  let response: Response;
  try {
    response = await send(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.model,
        voice: settings.voice,
        input: text,
        response_format: 'mp3',
      }),
    });
  } catch {
    // The cause can carry the URL; a plain message is enough and can never hold the key.
    throw new VoiceUnavailableError('The speech server could not be reached.');
  }
  if (!response.ok) throw new VoiceUnavailableError(`The speech server answered ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new VoiceUnavailableError('The speech server returned no audio.');
  return { bytes, contentType: 'audio/mpeg' };
}
