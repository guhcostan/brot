import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVault } from '../vault';
import {
  DEFAULT_REQUEST_DEADLINE_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  DEFAULT_STREAM_STALL_TIMEOUT_MS,
  createLlmRelay,
  type FetchLike,
  type LlmRelay,
  type RelayTimers,
  type RunUsage,
} from './relay';
import { createProviderRegistry, type ProviderSpec } from './providers';

const KEY = 'sk-live-SECRET-VALUE-123';
const RUN = 'run-1';
const encoder = new TextEncoder();

interface CountingTimer {
  timer: ReturnType<typeof setTimeout>;
}

/** Timers that count what is outstanding, so a test can assert nothing is left behind. */
function countingTimers(): { timers: RelayTimers; active: Set<CountingTimer> } {
  const active = new Set<CountingTimer>();
  return {
    active,
    timers: {
      setTimeout(callback, ms) {
        const handle: CountingTimer = {
          timer: setTimeout(() => {
            active.delete(handle);
            callback();
          }, ms),
        };
        active.add(handle);
        return handle;
      },
      clearTimeout(handle) {
        const entry = handle as CountingTimer;
        active.delete(entry);
        clearTimeout(entry.timer);
      },
    },
  };
}

interface Harness {
  relay: LlmRelay;
  token: string;
  usage: Array<{ runId: string; usage: RunUsage }>;
  activeTimers: Set<CountingTimer>;
  post(body?: Record<string, unknown>): Promise<Response>;
  close(): Promise<void>;
}

async function harness(
  fetch: FetchLike,
  options: { responseTimeoutMs?: number; streamStallTimeoutMs?: number; requestDeadlineMs?: number } = {},
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-relay-timeout-'));
  const vault = createVault({ dir });
  await vault.set('fake', KEY);
  const provider: ProviderSpec = {
    id: 'fake',
    api: 'openai-completions',
    baseUrl: 'http://provider.invalid/v1',
    secretName: 'fake',
    models: [{ id: 'model-1', cost: { input: 1, output: 2 } }],
  };
  const counters = countingTimers();
  const relay = createLlmRelay({
    vault,
    providers: createProviderRegistry([provider]),
    fetch,
    responseTimeoutMs: options.responseTimeoutMs ?? 5_000,
    streamStallTimeoutMs: options.streamStallTimeoutMs ?? 5_000,
    requestDeadlineMs: options.requestDeadlineMs ?? 30_000,
    timers: counters.timers,
  });
  const usage: Array<{ runId: string; usage: RunUsage }> = [];
  relay.onUsage((runId, value) => usage.push({ runId, usage: value }));
  const token = relay.issue(RUN, await relay.resolve('fake/model-1'));
  return {
    relay,
    token,
    usage,
    activeTimers: counters.active,
    async close() {
      await rm(dir, { recursive: true, force: true });
    },
    post(body = { model: 'model-1', messages: [] }) {
      return Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }),
      );
    },
  };
}

/** A fake provider that never answers, but records the abort. */
function hangingFetch(): { fetch: FetchLike; aborted: () => boolean } {
  let aborted = false;
  return {
    aborted: () => aborted,
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (signal?.aborted) {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      }),
  };
}

function streamResponse(chunks: readonly string[], close = true): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (close) controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'abc' } },
  );
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('relay timeouts', () => {
  it('documents the default timeouts', () => {
    expect(DEFAULT_RESPONSE_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_STREAM_STALL_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_REQUEST_DEADLINE_MS).toBe(15 * 60_000);
  });

  it('answers 502 when response headers do not arrive in time, aborting the upstream', async () => {
    const hanging = hangingFetch();
    const api = await harness(hanging.fetch, { responseTimeoutMs: 20 });
    try {
      const res = await api.post();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'Provider fake did not respond in time' });
      expect(hanging.aborted()).toBe(true);
      await settle();
      expect(api.activeTimers.size).toBe(0);
    } finally {
      await api.close();
    }
  });

  it('answers 502 with took-too-long when the total deadline passes before headers', async () => {
    const hanging = hangingFetch();
    const api = await harness(hanging.fetch, { responseTimeoutMs: 10_000, requestDeadlineMs: 20 });
    try {
      const res = await api.post();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'Provider fake took too long' });
      expect(hanging.aborted()).toBe(true);
      await settle();
      expect(api.activeTimers.size).toBe(0);
    } finally {
      await api.close();
    }
  });

  it('fails the client stream when the total deadline passes mid-body', async () => {
    let aborted = false;
    const fetch: FetchLike = async (_input, init) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return streamResponse([], false);
    };
    const api = await harness(fetch, { requestDeadlineMs: 25 });
    try {
      const res = await api.post();
      expect(res.status).toBe(200);
      if (res.body === null) throw new Error('the relay returned no body');
      const error = await rejectionOf(res.body.getReader().read());
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Provider fake took too long');
      expect(aborted).toBe(true);
      await settle();
      expect(api.activeTimers.size).toBe(0);
    } finally {
      await api.close();
    }
  });

  it('aborts a stalled stream, fails the client, and reports the usage seen before the stall', async () => {
    let aborted = false;
    const fetch: FetchLike = async (_input, init) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return streamResponse(['data: {"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n'], false);
    };
    const api = await harness(fetch, { streamStallTimeoutMs: 20 });
    try {
      const res = await api.post();
      expect(res.status).toBe(200);
      if (res.body === null) throw new Error('the relay returned no body');
      const reader = res.body.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(new TextDecoder().decode(first.value)).toContain('prompt_tokens');

      const error = await rejectionOf(reader.read());
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Provider fake stalled');
      expect(aborted).toBe(true);
      expect(api.usage).toEqual([
        { runId: RUN, usage: { tokensIn: 4, tokensOut: 2, costUsd: (4 * 1 + 2 * 2) / 1_000_000 } },
      ]);
      await settle();
      expect(api.activeTimers.size).toBe(0);
    } finally {
      await api.close();
    }
  });

  it('passes a normal stream through untouched and reports its usage', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n',
      'data: [DONE]\n\n',
    ];
    const api = await harness(async () => streamResponse(chunks));
    try {
      const res = await api.post();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      expect(res.headers.get('x-request-id')).toBe('abc');
      expect(await res.text()).toBe(chunks.join(''));
      expect(api.usage).toEqual([
        { runId: RUN, usage: { tokensIn: 2, tokensOut: 1, costUsd: (2 * 1 + 1 * 2) / 1_000_000 } },
      ]);
      await settle();
      expect(api.activeTimers.size).toBe(0);
    } finally {
      await api.close();
    }
  });

  it('aborts immediately when the caller signal aborts', async () => {
    const hanging = hangingFetch();
    const api = await harness(hanging.fetch);
    try {
      const caller = new AbortController();
      const request = new Request('http://localhost/llm/runs/run-1/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${api.token}` },
        body: JSON.stringify({ model: 'model-1' }),
        signal: caller.signal,
      });
      const pending = Promise.resolve(api.relay.route.request(request));
      caller.abort();
      const res = await pending;
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'Provider fake request was cancelled' });
      expect(hanging.aborted()).toBe(true);
      await settle();
      expect(api.activeTimers.size).toBe(0);
    } finally {
      await api.close();
    }
  });

  it('logs only the provider id and reason, never the key or the upstream URL', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(' '));
    });
    const first = hangingFetch();
    const headersApi = await harness(first.fetch, { responseTimeoutMs: 15 });
    try {
      await headersApi.post();
    } finally {
      await headersApi.close();
    }

    const stalling: FetchLike = async () => streamResponse([], false);
    const stallApi = await harness(stalling, { streamStallTimeoutMs: 15 });
    try {
      const res = await stallApi.post();
      if (res.body === null) throw new Error('the relay returned no body');
      await rejectionOf(res.body.getReader().read());
    } finally {
      await stallApi.close();
    }
    spy.mockRestore();

    expect(logs.some((line) => line.includes('Provider fake did not respond in time') || line.includes('provider fake did not respond in time'))).toBe(true);
    expect(logs.some((line) => line.includes('stalled'))).toBe(true);
    for (const line of logs) {
      expect(line).not.toContain(KEY);
      expect(line).not.toContain('provider.invalid');
    }
  });
});
