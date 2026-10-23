import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const path = new URL(input, 'http://brot.test').pathname;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    return respond({ method: init.method ?? 'GET', path, body });
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('transcription routes', () => {
  it('reads the status and its availability reason', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ settings: { model: 'opencode-go/deepseek-v4.1-flash', updatedAt: '2026-10-19T09:00:00.000Z' }, available: false, reason: 'No key.' }),
    );
    const client = createHttpClient({ fetch });

    await expect(client.getTranscriptionStatus()).resolves.toEqual({
      settings: { model: 'opencode-go/deepseek-v4.1-flash', updatedAt: '2026-10-19T09:00:00.000Z' },
      available: false,
      reason: 'No key.',
    });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/transcription' });
  });

  it('tolerates an empty payload', async () => {
    const client = createHttpClient({ fetch: fakeFetch(() => json({})).fetch });
    await expect(client.getTranscriptionStatus()).resolves.toEqual({ settings: {}, available: false });
  });

  it('puts a model and clears with null', async () => {
    const { fetch, calls } = fakeFetch(() => json({ settings: { model: 'opencode-go/deepseek-v4.1-flash' }, available: true }));
    const client = createHttpClient({ fetch });

    await expect(client.updateTranscriptionSettings({ model: 'opencode-go/deepseek-v4.1-flash' })).resolves.toMatchObject({ available: true });
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/transcription', body: { model: 'opencode-go/deepseek-v4.1-flash' } });

    await client.updateTranscriptionSettings({ model: null });
    expect(calls[1]?.body).toEqual({ model: null });
  });

  it('rejects a blank model before sending and surfaces a 400', async () => {
    const { fetch, calls } = fakeFetch(() => json({ error: 'model cannot transcribe' }, 400));
    const client = createHttpClient({ fetch });

    await expect(client.updateTranscriptionSettings({ model: '   ' })).rejects.toThrow();
    expect(calls).toHaveLength(0);

    await expect(client.updateTranscriptionSettings({ model: 'anthropic/claude-sonnet' })).rejects.toThrow('400 model cannot transcribe');
  });

  it('parses per-model transcription flags from providers, tolerating their absence', async () => {
    const { fetch } = fakeFetch(() =>
      json([
        { id: 'opencode-go', label: 'OpenCode Go', configured: true, secretName: 'KEY', models: [{ id: 'flash', transcription: true }, { id: 'big' }] },
      ]),
    );
    const client = createHttpClient({ fetch });

    const [provider] = await client.listProviders();
    expect(provider?.models[0]).toMatchObject({ id: 'opencode-go/flash', transcription: true });
    expect(provider?.models[1]).not.toHaveProperty('transcription');
  });
});
