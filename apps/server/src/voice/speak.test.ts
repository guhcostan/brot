import { stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { VoiceSettings } from '@brot/protocol';
import type { Vault } from '../vault';
import { VoiceUnavailableError, speak, type VoiceFetch } from './speak';
import type { SpeechRunner } from './spawn';

const settings: VoiceSettings = { provider: 'system', voice: '', secretName: 'tts' };

/** A runner that records each argv and writes the output file the command would have produced. */
function fakeRunner(bytes: { aiff?: string; wav?: string } = {}): SpeechRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(argv) {
      calls.push(argv);
      const target = argv[0] === 'afconvert' ? argv.at(-1) : argv[argv.indexOf('-o') + 1];
      const content = argv[0] === 'afconvert' ? (bytes.wav ?? 'WAV') : (bytes.aiff ?? 'AIFF');
      if (target !== undefined) await writeFile(target, content);
      return { code: 0, stderr: '' };
    },
  };
}

function vaultWith(entries: Record<string, string>): Pick<Vault, 'resolveRef'> {
  return {
    async resolveRef(ref) {
      return entries[ref.replace('secret://', '')];
    },
  };
}

const noBinary = async (): Promise<boolean> => false;

describe('the system provider', () => {
  it('is unavailable off macOS', async () => {
    await expect(speak('Hello', settings, { vault: vaultWith({}), platform: 'linux', hasBinary: noBinary })).rejects.toThrow(
      /macOS/,
    );
  });

  it('is unavailable when the say command is missing', async () => {
    await expect(
      speak('Hello', settings, { vault: vaultWith({}), platform: 'darwin', hasBinary: noBinary }),
    ).rejects.toThrow(/"say" command/);
  });

  it('runs say and afconvert and returns WAV bytes', async () => {
    const runner = fakeRunner({ aiff: 'AIFF', wav: 'WAV-BYTES' });
    const result = await speak('Hello there', settings, {
      vault: vaultWith({}),
      platform: 'darwin',
      hasBinary: async () => true,
      run: runner,
    });

    expect(result.contentType).toBe('audio/wav');
    expect(new TextDecoder().decode(result.bytes)).toBe('WAV-BYTES');
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]?.slice(0, 2)).toEqual(['say', '-o']);
    expect(runner.calls[0]?.[2]).toMatch(/speech\.aiff$/);
    expect(runner.calls[0]?.at(-1)).toBe('Hello there');
    expect(runner.calls[1]?.slice(0, 5)).toEqual(['afconvert', '-f', 'WAVE', '-d', 'LEI16@22050']);
    expect(runner.calls[1]?.[5]).toMatch(/speech\.aiff$/);
    expect(runner.calls[1]?.[6]).toMatch(/speech\.wav$/);
  });

  it('passes the configured voice to say', async () => {
    const runner = fakeRunner();
    const result = await speak('Hi', { ...settings, voice: 'Samantha' }, {
      vault: vaultWith({}),
      platform: 'darwin',
      hasBinary: async (name) => name === 'say',
      run: runner,
    });
    expect(runner.calls[0]?.slice(0, 3)).toEqual(['say', '-v', 'Samantha']);
    expect(runner.calls[0]).toHaveLength(6);
    expect(result.contentType).toBe('audio/aiff');
  });

  it('returns the AIFF when afconvert is not installed', async () => {
    const runner = fakeRunner({ aiff: 'AIFF-BYTES' });
    const result = await speak('Hello', settings, {
      vault: vaultWith({}),
      platform: 'darwin',
      hasBinary: async (name) => name === 'say',
      run: runner,
    });
    expect(result).toMatchObject({ contentType: 'audio/aiff' });
    expect(new TextDecoder().decode(result.bytes)).toBe('AIFF-BYTES');
    expect(runner.calls).toHaveLength(1);
  });

  it('falls back to the AIFF when the conversion fails', async () => {
    const runner: SpeechRunner = {
      async run(argv) {
        if (argv[0] === 'afconvert') return { code: 1, stderr: 'conversion failed' };
        await writeFile(argv[argv.indexOf('-o') + 1] ?? '', 'AIFF-FALLBACK');
        return { code: 0, stderr: '' };
      },
    };
    const result = await speak('Hello', settings, {
      vault: vaultWith({}),
      platform: 'darwin',
      hasBinary: async () => true,
      run: runner,
    });
    expect(result.contentType).toBe('audio/aiff');
    expect(new TextDecoder().decode(result.bytes)).toBe('AIFF-FALLBACK');
  });

  it('reports a failed say command without the text or secrets', async () => {
    const runner: SpeechRunner = { run: async () => ({ code: 1, stderr: 'Voice "Nope" not found' }) };
    await expect(
      speak('secret words', settings, {
        vault: vaultWith({ 'tts': 'sk-secret' }),
        platform: 'darwin',
        hasBinary: async () => true,
        run: runner,
      }),
    ).rejects.toThrow(/say.*failed: Voice "Nope" not found/);
  });

  it('cleans up its temporary directory', async () => {
    let directory: string | undefined;
    const runner: SpeechRunner = {
      async run(argv) {
        const file = argv[argv.indexOf('-o') + 1] ?? '';
        directory = dirname(file);
        await writeFile(file, 'AIFF');
        return { code: 0, stderr: '' };
      },
    };
    await speak('Hello', settings, {
      vault: vaultWith({}),
      platform: 'darwin',
      hasBinary: async (name) => name === 'say',
      run: runner,
    });
    await expect(stat(directory ?? '')).rejects.toThrow();
  });
});

const serverSettings: VoiceSettings = {
  provider: 'openai-compatible',
  voice: 'alloy',
  model: 'tts-1',
  baseUrl: 'https://tts.example.com/v1',
  secretName: 'voice-key',
};

describe('the openai-compatible provider', () => {
  it('posts the speech request with the vault key and returns MP3 bytes', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchImpl: VoiceFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    };
    const result = await speak('Hello', serverSettings, {
      vault: vaultWith({ 'voice-key': 'sk-secret-value' }),
      fetch: fetchImpl,
    });

    expect(result.contentType).toBe('audio/mpeg');
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]?.url.toString()).toBe('https://tts.example.com/v1/audio/speech');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-secret-value',
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: 'tts-1',
      voice: 'alloy',
      input: 'Hello',
      response_format: 'mp3',
    });
  });

  it('needs the key in the vault, without ever naming its value', async () => {
    await expect(
      speak('Hello', serverSettings, { vault: vaultWith({}), fetch: async () => new Response(null) }),
    ).rejects.toThrow(/vault has no "voice-key" secret/);
  });

  it('reports a failed server call without leaking the key', async () => {
    const fetchImpl: VoiceFetch = async () =>
      new Response('nope', { status: 500, headers: { 'content-type': 'text/plain' } });
    const error = await speak('Hello', serverSettings, {
      vault: vaultWith({ 'voice-key': 'sk-secret-value' }),
      fetch: fetchImpl,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VoiceUnavailableError);
    expect(String(error)).toContain('answered 500');
    expect(String(error)).not.toContain('sk-secret-value');
  });

  it('reports an unreachable server plainly', async () => {
    const fetchImpl: VoiceFetch = async () => {
      throw new Error('connect ECONNREFUSED https://tts.example.com');
    };
    await expect(
      speak('Hello', serverSettings, {
        vault: vaultWith({ 'voice-key': 'sk-secret-value' }),
        fetch: fetchImpl,
      }),
    ).rejects.toThrow('The speech server could not be reached.');
  });

  it('refuses a server without a base URL or model', async () => {
    const incomplete: VoiceSettings = { provider: 'openai-compatible', voice: '', secretName: 'tts' };
    await expect(
      speak('Hello', incomplete, { vault: vaultWith({ tts: 'sk' }), fetch: async () => new Response(null) }),
    ).rejects.toThrow(/base URL and a model/);
  });

  it('refuses an empty audio response', async () => {
    await expect(
      speak('Hello', serverSettings, {
        vault: vaultWith({ 'voice-key': 'sk-secret-value' }),
        fetch: async () => new Response(new Uint8Array()),
      }),
    ).rejects.toThrow(/returned no audio/);
  });
});
