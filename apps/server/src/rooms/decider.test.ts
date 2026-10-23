import type { Repos } from '@brot/db';
import { describe, expect, it, vi } from 'vitest';
import { createProviderRegistry, type FetchLike, type ProviderSpec } from '../llm';
import {
  createRoomDecider,
  readRoomDeciderSettings,
  ROOM_DECIDER_SETTINGS_KEY,
  writeRoomDeciderSettings,
  type RoomDeciderMember,
} from './decider';

const PROVIDERS: ProviderSpec[] = [
  { id: 'fake', api: 'openai-completions', baseUrl: 'https://fake.example/v1', secretName: 'fake' },
  {
    id: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://anthropic.example/v1',
    secretName: 'anthropic',
  },
];

const providers = createProviderRegistry(PROVIDERS);
const vault = { resolveRef: async (ref: string) => (ref === 'secret://fake' ? 'sk-decider-test' : undefined) };

const members: RoomDeciderMember[] = [
  { id: 'capy', name: 'Capy', job: 'Lead' },
  { id: 'dex', name: 'Dex', job: 'Developer' },
];

interface CapturedCall {
  url: string;
  init: RequestInit;
}

/** A fetch that answers with the chat-completions shape, recording each call. */
function answerFetch(answer: string): { fetch: FetchLike; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ choices: [{ message: { role: 'assistant', content: answer } }] });
  };
  return { fetch, calls };
}

/** In-memory stand-in for the generic settings repo. */
function fakeSettings(initial: Record<string, unknown> = {}): Pick<Repos, 'settings'> {
  const values = new Map(Object.entries(initial));
  return {
    settings: {
      async get<T>(key: string, schema: { parse(value: unknown): T }): Promise<T | undefined> {
        const value = values.get(key);
        if (value === undefined) return undefined;
        try {
          return schema.parse(value);
        } catch {
          return undefined;
        }
      },
      async set<T>(key: string, value: T): Promise<void> {
        values.set(key, value);
      },
      async remove(key: string): Promise<boolean> {
        return values.delete(key);
      },
    },
  };
}

function makeDecider(options: {
  settings?: Record<string, unknown>;
  fetch: FetchLike;
  timeoutMs?: number;
}): ReturnType<typeof createRoomDecider> {
  return createRoomDecider({
    repos: fakeSettings(
      options.settings === undefined ? {} : { [ROOM_DECIDER_SETTINGS_KEY]: options.settings },
    ),
    providers,
    vault,
    fetch: options.fetch,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
}

const ask = (message = 'Who handles the launch?') => ({ members, message });

describe('createRoomDecider', () => {
  it('asks the configured model for a bot and calls the provider with the key, model and bot list', async () => {
    const { fetch, calls } = answerFetch('capy');
    const decider = makeDecider({ settings: { model: 'fake/model-1' }, fetch });

    expect(await decider.choose(ask())).toBe('capy');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://fake.example/v1/chat/completions');
    expect(call?.init.method).toBe('POST');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-decider-test');
    expect(headers.get('content-type')).toBe('application/json');
    const body = JSON.parse(String(call?.init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      temperature: number;
      max_tokens: number;
      stream: boolean;
    };
    expect(body).toMatchObject({ model: 'model-1', temperature: 0, max_tokens: 64, stream: false });
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[0]?.content).toContain('capy — Capy — Lead');
    expect(body.messages[0]?.content).toContain('dex — Dex — Developer');
    expect(body.messages[0]?.content).toContain('Answer with only the bot id');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Who handles the launch?' });
  });

  it('accepts the id, @id, the name, or a quoted first line', async () => {
    for (const [answer, expected] of [
      ['capy', 'capy'],
      ['  dex  ', 'dex'],
      ['@dex', 'dex'],
      ['**capy**', 'capy'],
      ['"Dex".', 'dex'],
      ['`capy`', 'capy'],
      ['Dex\nbecause it is a developer task', 'dex'],
    ] as const) {
      const decider = makeDecider({ settings: { model: 'fake/model-1' }, fetch: answerFetch(answer).fetch });
      expect(await decider.choose(ask())).toBe(expected);
    }
  });

  it('returns undefined for an answer that names no member', async () => {
    const decider = makeDecider({ settings: { model: 'fake/model-1' }, fetch: answerFetch('ghost').fetch });
    expect(await decider.choose(ask())).toBeUndefined();
    const silent = makeDecider({ settings: { model: 'fake/model-1' }, fetch: answerFetch('   ').fetch });
    expect(await silent.choose(ask())).toBeUndefined();
  });

  it('returns undefined without a configured model', async () => {
    const { fetch, calls } = answerFetch('capy');
    const decider = makeDecider({ fetch });
    expect(await decider.choose(ask())).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('returns undefined for an unknown provider, a non-openai provider, or an unreadable model', async () => {
    for (const model of ['ghost/model-1', 'anthropic/claude-x', 'not-a-ref']) {
      const { fetch, calls } = answerFetch('capy');
      const decider = makeDecider({ settings: { model }, fetch });
      expect(await decider.choose(ask())).toBeUndefined();
      expect(calls).toEqual([]);
    }
  });

  it('returns undefined when the provider has no vault key', async () => {
    const { fetch, calls } = answerFetch('capy');
    const decider = createRoomDecider({
      repos: fakeSettings({ model: 'fake/model-1' }),
      providers,
      vault: { resolveRef: async () => undefined },
      fetch,
    });
    expect(await decider.choose(ask())).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('returns undefined on a non-2xx answer, a malformed body, an empty answer, or a network failure', async () => {
    const statusFetch: FetchLike = async () => new Response('upstream down', { status: 500 });
    expect(await makeDecider({ settings: { model: 'fake/model-1' }, fetch: statusFetch }).choose(ask())).toBeUndefined();

    const malformedFetch: FetchLike = async () => new Response('<html>not json</html>');
    expect(await makeDecider({ settings: { model: 'fake/model-1' }, fetch: malformedFetch }).choose(ask())).toBeUndefined();

    const emptyChoices: FetchLike = async () => Response.json({ choices: [] });
    expect(await makeDecider({ settings: { model: 'fake/model-1' }, fetch: emptyChoices }).choose(ask())).toBeUndefined();

    const brokenFetch: FetchLike = async () => {
      throw new Error('connection refused');
    };
    expect(await makeDecider({ settings: { model: 'fake/model-1' }, fetch: brokenFetch }).choose(ask())).toBeUndefined();
  });

  it('gives up after the timeout', async () => {
    const hangingFetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const decider = makeDecider({ settings: { model: 'fake/model-1' }, fetch: hangingFetch, timeoutMs: 10 });

    expect(await decider.choose(ask())).toBeUndefined();
  });

  it('caps the message it sends to the model', async () => {
    const { fetch, calls } = answerFetch('capy');
    const decider = makeDecider({ settings: { model: 'fake/model-1' }, fetch });

    await decider.choose({ members, message: 'x'.repeat(5000) });

    const body = JSON.parse(String(calls[0]?.init.body)) as { messages: Array<{ content: string }> };
    expect(body.messages[1]?.content).toHaveLength(4000);
  });

  it('logs only the failure reason, never the key or the message content', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const message = 'secret plans for the launch';
      const brokenFetch: FetchLike = async () => {
        throw new Error(`could not reach https://fake.example/v1 with sk-decider-test for ${message}`);
      };
      const decider = makeDecider({ settings: { model: 'fake/model-1' }, fetch: brokenFetch });
      expect(await decider.choose({ members, message })).toBeUndefined();

      expect(errors).toHaveBeenCalled();
      const logged = errors.mock.calls.flat().map((part) => String(part)).join(' ');
      expect(logged).toContain('room decider');
      expect(logged).not.toContain('sk-decider-test');
      expect(logged).not.toContain(message);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('room decider settings', () => {
  it('reads nothing as an empty object, saves a model with updatedAt, and clears with null', async () => {
    const repos = fakeSettings();
    expect(await readRoomDeciderSettings(repos)).toEqual({});

    const saved = await writeRoomDeciderSettings(repos, 'fake/model-1');
    expect(saved).toMatchObject({ model: 'fake/model-1', updatedAt: expect.any(String) });
    expect(await readRoomDeciderSettings(repos)).toEqual(saved);

    expect(await writeRoomDeciderSettings(repos, null)).toEqual({});
    expect(await readRoomDeciderSettings(repos)).toEqual({});
    expect(repos.settings.get(ROOM_DECIDER_SETTINGS_KEY, { parse: (value: unknown) => value })).resolves.toBeUndefined();
  });
});
