import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProviderRegistry,
  loadProviderFile,
  mergeProviders,
  parseModelRef,
  SEEDED_PROVIDERS,
  type ProviderSpec,
} from './providers';

describe('parseModelRef', () => {
  it('splits at the first slash', () => {
    expect(parseModelRef('opencode-go/deepseek-v4.1-flash')).toEqual({
      provider: 'opencode-go',
      model: 'deepseek-v4.1-flash',
    });
  });

  it('keeps further slashes in the model id', () => {
    expect(parseModelRef('openrouter/anthropic/claude-x')).toEqual({ provider: 'openrouter', model: 'anthropic/claude-x' });
  });

  it.each(['deepseek', '/deepseek-flash', 'deepseek/', ''])('refuses %j, which is not <provider>/<model>', (ref) => {
    expect(() => parseModelRef(ref)).toThrow(/must be <provider>\/<model>/);
  });
});

describe('seeded providers', () => {
  it('seeds opencode-go and deepseek with their secret names and no keys', () => {
    const registry = createProviderRegistry(SEEDED_PROVIDERS);
    expect(registry.get('opencode-go')).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://opencode.ai/inference/go/v1',
      secretName: 'opencode-go',
    });
    expect(registry.get('deepseek')).toMatchObject({
      baseUrl: 'https://api.deepseek.com/v1',
      secretName: 'deepseek',
    });
    expect(JSON.stringify(SEEDED_PROVIDERS)).not.toMatch(/sk-|apiKey|api_key/);
  });
});

describe('mergeProviders', () => {
  const base: ProviderSpec = { id: 'a', api: 'openai-completions', baseUrl: 'https://a.example/v1', secretName: 'a' };

  it('replaces an earlier layer with a later one of the same id, and keeps the rest', () => {
    const merged = mergeProviders([base], [{ ...base, baseUrl: 'https://a2.example/v1' }, { ...base, id: 'b' }]);
    expect(merged.map((spec) => [spec.id, spec.baseUrl])).toEqual([
      ['a', 'https://a2.example/v1'],
      ['b', 'https://a.example/v1'],
    ]);
  });
});

describe('loadProviderFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'brot-providers-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(content: unknown): Promise<string> {
    const path = join(dir, 'providers.json');
    await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  }

  it('returns no providers when the file is absent', async () => {
    expect(await loadProviderFile(join(dir, 'providers.json'))).toEqual([]);
  });

  it('reads valid providers and trims the trailing slash of baseUrl', async () => {
    const path = await write({
      providers: [
        {
          id: 'local',
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:11434/v1/',
          secretName: 'local',
          models: [{ id: 'llama', cost: { input: 0, output: 0 } }],
        },
      ],
    });
    expect(await loadProviderFile(path)).toEqual([
      {
        id: 'local',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:11434/v1',
        secretName: 'local',
        models: [{ id: 'llama', cost: { input: 0, output: 0 } }],
      },
    ]);
  });

  it('refuses a key field, so no key can be written into the file', async () => {
    const path = await write({
      providers: [{ id: 'x', api: 'openai-completions', baseUrl: 'https://x.example/v1', secretName: 'x', apiKey: 'sk-live' }],
    });
    const error = await loadProviderFile(path).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('apiKey');
    expect((error as Error).message).not.toContain('sk-live');
  });

  it('refuses plain http to a remote host, credentials in the URL, and unknown apis', async () => {
    const remote = await write({
      providers: [{ id: 'x', api: 'openai-completions', baseUrl: 'http://x.example/v1', secretName: 'x' }],
    });
    await expect(loadProviderFile(remote)).rejects.toThrow(/baseUrl/);

    const credentials = await write({
      providers: [{ id: 'x', api: 'openai-completions', baseUrl: 'https://user:pw@x.example/v1', secretName: 'x' }],
    });
    await expect(loadProviderFile(credentials)).rejects.toThrow(/baseUrl/);

    const api = await write({
      providers: [{ id: 'x', api: 'gemini-native', baseUrl: 'https://x.example/v1', secretName: 'x' }],
    });
    await expect(loadProviderFile(api)).rejects.toThrow(/api/);
  });

  it('refuses a secret name the vault would not accept', async () => {
    const path = await write({
      providers: [{ id: 'x', api: 'openai-completions', baseUrl: 'https://x.example/v1', secretName: '../etc' }],
    });
    await expect(loadProviderFile(path)).rejects.toThrow(/secretName/);
  });

  it('refuses invalid JSON with the file path', async () => {
    const path = await write('{ not json');
    await expect(loadProviderFile(path)).rejects.toThrow(`${path} is not valid JSON`);
  });
});
