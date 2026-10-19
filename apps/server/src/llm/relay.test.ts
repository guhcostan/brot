import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVault, type Vault } from '../vault';
import { createLlmRelay, type LlmRelay, type RunUsage } from './relay';
import { createProviderRegistry, type ProviderSpec } from './providers';

const KEY = 'sk-live-SECRET-VALUE-123';
const RUN = 'run-1';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

interface Upstream {
  baseUrl: string;
  seen: Seen[];
  setHandler(handler: (req: IncomingMessage, res: ServerResponse) => void): void;
  close(): Promise<void>;
}

/** A real HTTP server on loopback that records every request and answers with the current handler. */
async function startUpstream(): Promise<Upstream> {
  const seen: Seen[] = [];
  let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"object":"list"}');
  };
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    seen,
    setHandler(next) {
      handler = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe('model relay', () => {
  let dir: string;
  let vault: Vault;
  let upstream: Upstream;
  let relay: LlmRelay;
  let token: string;
  let usage: Array<{ runId: string; usage: RunUsage }>;

  const openai: ProviderSpec = {
    id: 'fake',
    api: 'openai-completions',
    baseUrl: '',
    secretName: 'fake',
    models: [{ id: 'model-1', cost: { input: 1, output: 2 } }],
  };
  const anthropic: ProviderSpec = { id: 'claude', api: 'anthropic-messages', baseUrl: '', secretName: 'claude' };

  async function build(options: { maxRequestBytes?: number; providers?: ProviderSpec[] } = {}): Promise<void> {
    relay = createLlmRelay({
      vault,
      providers: createProviderRegistry(options.providers ?? [openai, anthropic]),
      ...(options.maxRequestBytes === undefined ? {} : { maxRequestBytes: options.maxRequestBytes }),
    });
    usage = [];
    relay.onUsage((runId, value) => usage.push({ runId, usage: value }));
    token = relay.issue(RUN, await relay.resolve('fake/model-1'));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'brot-llm-'));
    vault = createVault({ dir });
    await vault.set('fake', KEY);
    await vault.set('claude', 'sk-ant-SECRET');
    upstream = await startUpstream();
    openai.baseUrl = `${upstream.baseUrl}/v1`;
    anthropic.baseUrl = `${upstream.baseUrl}/anthropic/v1`;
    await build();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  });

  function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return Promise.resolve(
      relay.route.request(`/llm/runs/${RUN}/v1/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
        body: JSON.stringify(body),
      }),
    );
  }

  describe('authentication', () => {
    it('answers 401 with a bearer challenge when no token is sent', async () => {
      const res = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/models`, { method: 'GET' }),
      );
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(upstream.seen).toHaveLength(0);
    });

    it('answers 401 for a wrong token', async () => {
      const res = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/models`, { headers: { authorization: 'Bearer nope' } }),
      );
      expect(res.status).toBe(401);
    });

    it('answers 401 for another run id', async () => {
      const res = await Promise.resolve(
        relay.route.request('/llm/runs/other/v1/models', { headers: { authorization: `Bearer ${token}` } }),
      );
      expect(res.status).toBe(401);
    });

    it('answers 401 once the run has settled', async () => {
      relay.revoke(RUN);
      const res = await post('chat/completions', { model: 'model-1' });
      expect(res.status).toBe(401);
      expect(upstream.seen).toHaveLength(0);
    });

    it('accepts the token in x-api-key, the header Anthropic clients send', async () => {
      const res = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/models`, { headers: { 'x-api-key': token } }),
      );
      expect(res.status).toBe(200);
    });

    it('issues a 256-bit token and a new one for every issue', () => {
      const first = relay.issue('a', { provider: openai, model: 'model-1' });
      const second = relay.issue('a', { provider: openai, model: 'model-1' });
      expect(first.length).toBeGreaterThanOrEqual(43);
      expect(second).not.toBe(first);
    });
  });

  describe('endpoint allowlist', () => {
    it('refuses paths the provider does not offer, with 404', async () => {
      expect((await post('files', { model: 'model-1' })).status).toBe(404);
      expect((await post('chat/completions/../../files', { model: 'model-1' })).status).toBe(404);
      expect(upstream.seen).toHaveLength(0);
    });

    it('refuses the wrong method for a path, with 405 and an Allow header', async () => {
      const get = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/chat/completions`, { headers: { authorization: `Bearer ${token}` } }),
      );
      expect(get.status).toBe(405);
      expect(get.headers.get('allow')).toBe('POST');

      const postModels = await post('models', {});
      expect(postModels.status).toBe(405);
      expect(postModels.headers.get('allow')).toBe('GET');

      const del = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/models`, {
          method: 'DELETE',
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      expect(del.status).toBe(405);
      expect(upstream.seen).toHaveLength(0);
    });

    it('forwards the models listing with GET and no body', async () => {
      const res = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/models`, { headers: { authorization: `Bearer ${token}` } }),
      );
      expect(res.status).toBe(200);
      expect(upstream.seen).toEqual([
        expect.objectContaining({ method: 'GET', url: '/v1/models' }),
      ]);
      expect(usage).toEqual([]);
    });
  });

  describe('model pin', () => {
    it('refuses a body that names another model with 403 and does not forward it', async () => {
      const res = await post('chat/completions', { model: 'expensive-model', messages: [] });
      expect(res.status).toBe(403);
      expect(upstream.seen).toHaveLength(0);
    });

    it('refuses a body with no model, since the provider would choose one', async () => {
      expect((await post('chat/completions', { messages: [] })).status).toBe(403);
    });

    it('refuses a body that is not a JSON object with 400', async () => {
      const res = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: '[1,2]',
        }),
      );
      expect(res.status).toBe(400);
      expect(upstream.seen).toHaveLength(0);
    });

    it('forwards the body byte for byte when the model matches', async () => {
      const payload = { model: 'model-1', messages: [{ role: 'user', content: 'hi' }] };
      const res = await post('chat/completions', payload);
      expect(res.status).toBe(200);
      expect(upstream.seen[0]?.body).toBe(JSON.stringify(payload));
    });

    it('refuses a body above the size cap with 413', async () => {
      await build({ maxRequestBytes: 64 });
      const res = await post('chat/completions', { model: 'model-1', padding: 'x'.repeat(200) });
      expect(res.status).toBe(413);
      expect(upstream.seen).toHaveLength(0);
    });
  });

  describe('key injection and redaction', () => {
    it('adds the vault key upstream, never forwards the run token, and never returns the key', async () => {
      const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
      upstream.setHandler((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=up', 'x-trace': 'abc' });
        res.end('{"id":"r1","object":"chat.completion","usage":{"prompt_tokens":4,"completion_tokens":1}}');
      });

      const res = await Promise.resolve(
        relay.route.request(`/llm/runs/${RUN}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            cookie: 'client=1',
            'accept-encoding': 'br',
          },
          body: JSON.stringify({ model: 'model-1' }),
        }),
      );
      const text = await res.text();

      const sent = upstream.seen[0];
      expect(sent?.headers.authorization).toBe(`Bearer ${KEY}`);
      expect(sent?.headers.cookie).toBeUndefined();
      expect(JSON.stringify(sent?.headers)).not.toContain(token);

      expect(text).not.toContain(KEY);
      expect(text).not.toContain(token);
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('x-trace')).toBe('abc');
      for (const spy of logs) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
      }
    });

    it('uses x-api-key upstream for anthropic-messages', async () => {
      const anthropicToken = relay.issue('run-claude', await relay.resolve('claude/claude-x'));
      const res = await Promise.resolve(
        relay.route.request('/llm/runs/run-claude/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': anthropicToken, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-x' }),
        }),
      );
      expect(res.status).toBe(200);
      expect(upstream.seen[0]?.url).toBe('/anthropic/v1/messages');
      expect(upstream.seen[0]?.headers['x-api-key']).toBe('sk-ant-SECRET');
      expect(upstream.seen[0]?.headers.authorization).toBeUndefined();
      expect(upstream.seen[0]?.headers['anthropic-version']).toBe('2023-06-01');
    });

    it('does not follow a redirect, so the key cannot reach another host', async () => {
      upstream.setHandler((_req, res) => {
        res.writeHead(307, { location: 'http://127.0.0.1:1/elsewhere' });
        res.end();
      });
      const res = await post('chat/completions', { model: 'model-1' });
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('http://127.0.0.1:1/elsewhere');
      expect(upstream.seen).toHaveLength(1);
    });

    it('answers 503 naming the secret when the key was removed during the run', async () => {
      await vault.delete('fake');
      const res = await post('chat/completions', { model: 'model-1' });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('"fake"');
      expect(body.error).toContain('PUT /api/secrets/fake');
      expect(upstream.seen).toHaveLength(0);
    });

    it('answers 502 when the provider cannot be reached, without echoing the target', async () => {
      await build({ providers: [{ ...openai, baseUrl: 'http://127.0.0.1:1/v1' }] });
      const res = await post('chat/completions', { model: 'model-1' });
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain('127.0.0.1');
    });
  });

  describe('streaming and usage', () => {
    it('streams server-sent events as they arrive, before the upstream ends', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      upstream.setHandler((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n');
        void gate.then(() => {
          res.write('data: {"choices":[],"usage":{"prompt_tokens":6,"completion_tokens":3}}\n\n');
          res.end('data: [DONE]\n\n');
        });
      });

      try {
        const res = await post('chat/completions', { model: 'model-1', stream: true });
        expect(res.status).toBe(200);
        const reader = res.body?.getReader();
        if (reader === undefined) throw new Error('no body');
        const first = await withTimeout(reader.read(), 2000, 'the first event did not arrive before the upstream ended');
        expect(new TextDecoder().decode(first.value)).toContain('first');
        expect(usage).toEqual([]);
        release();
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
        }
      } finally {
        release();
      }

      expect(usage).toEqual([
        { runId: RUN, usage: { tokensIn: 6, tokensOut: 3, costUsd: (6 * 1 + 3 * 2) / 1_000_000 } },
      ]);
    });

    it('reports usage from a JSON response with the cost of the model', async () => {
      upstream.setHandler((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50 } }));
      });
      await post('chat/completions', { model: 'model-1' }).then((res) => res.text());
      expect(usage).toEqual([
        { runId: RUN, usage: { tokensIn: 100, tokensOut: 50, costUsd: (100 + 100) / 1_000_000 } },
      ]);
    });

    it('reports tokens with zero cost when the model has no known price', async () => {
      await build({ providers: [{ ...openai, models: undefined }, anthropic] });
      upstream.setHandler((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ usage: { prompt_tokens: 7, completion_tokens: 2 } }));
      });
      await post('chat/completions', { model: 'model-1' }).then((res) => res.text());
      expect(usage).toEqual([{ runId: RUN, usage: { tokensIn: 7, tokensOut: 2, costUsd: 0 } }]);
    });

    it('does not report usage from a failed response', async () => {
      upstream.setHandler((_req, res) => {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }));
      });
      const res = await post('chat/completions', { model: 'model-1' });
      expect(res.status).toBe(429);
      await res.text();
      expect(usage).toEqual([]);
    });
  });

  describe('resolve', () => {
    it('resolves a known provider whose secret is set', async () => {
      await expect(relay.resolve('fake/model-1')).resolves.toEqual({ provider: openai, model: 'model-1' });
    });

    it('refuses an unknown provider and names the providers it knows', async () => {
      await expect(relay.resolve('nope/model-1')).rejects.toThrow(/Unknown model provider "nope".*fake, claude/);
    });

    it('names the secret and how to add it when the vault lacks it', async () => {
      await vault.delete('fake');
      const error = await relay.resolve('fake/model-1').catch((caught: unknown) => caught);
      expect((error as Error).message).toContain('secret://fake');
      expect((error as Error).message).toContain('PUT /api/secrets/fake');
    });

    it('refuses a model string without a provider', async () => {
      await expect(relay.resolve('model-1')).rejects.toThrow(/<provider>\/<model>/);
    });
  });
});
