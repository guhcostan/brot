import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Vault } from '../vault';
import { parseModelRef, type ProviderApi, type ProviderRegistry, type ProviderSpec } from './providers';
import { costOf, createUsageSink, type TokenCounts, type UsageSink } from './usage';

/** Largest request body the relay forwards. Longer bodies are refused before they reach the provider. */
export const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

/** How long the provider gets to answer with response headers before the relay gives up. */
export const DEFAULT_RESPONSE_TIMEOUT_MS = 120_000;
/** Longest gap allowed between response body chunks once the provider is streaming. */
export const DEFAULT_STREAM_STALL_TIMEOUT_MS = 120_000;
/** Longest one relayed provider request may take end to end. */
export const DEFAULT_REQUEST_DEADLINE_MS = 15 * 60_000;

/** Timer seam so tests can count outstanding timers. Production timers are unref'd and never keep Brot alive. */
export interface RelayTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: RelayTimers = {
  setTimeout(callback, ms) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return timer;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Paths each wire protocol may reach, with the one method each accepts. Everything else is refused, so a run
 * cannot reach provider endpoints such as file upload or fine-tuning with the key.
 */
const RELAYED_ENDPOINTS: Record<ProviderApi, Record<string, 'GET' | 'POST'>> = {
  'openai-completions': { 'chat/completions': 'POST', models: 'GET' },
  'openai-responses': { responses: 'POST', models: 'GET' },
  'anthropic-messages': { messages: 'POST', models: 'GET' },
};

const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'expect',
];

/** Caller headers that never reach the provider: the run token, cookies, and the framing the relay recomputes. */
const REQUEST_DROPPED = new Set([...HOP_BY_HOP, 'authorization', 'x-api-key', 'cookie', 'host', 'content-length', 'accept-encoding']);
/** Provider headers that never reach the caller. Cookies stay with the provider, and the body is decoded by fetch. */
const RESPONSE_DROPPED = new Set([...HOP_BY_HOP, 'set-cookie', 'content-encoding', 'content-length']);

/** A run's model, resolved from its bot. `model` is the id the provider expects. */
export interface ResolvedRoute {
  provider: ProviderSpec;
  model: string;
  /** The model's `vision` flag in the provider config. Only a vision route gets image prompt blocks. */
  vision: boolean;
  /** Stable id of the conversation (thread and bot), sent in the provider's `sessionHeader`. */
  session?: string;
}

/** Token usage of one provider response, with its estimated cost. */
export interface RunUsage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export type UsageListener = (runId: string, usage: RunUsage) => void;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface LlmRelayOptions {
  vault: Pick<Vault, 'has' | 'resolveRef'>;
  providers: ProviderRegistry;
  /** Outbound HTTP. Tests inject a fake upstream. */
  fetch?: FetchLike;
  /** Overrides `MAX_REQUEST_BYTES`. */
  maxRequestBytes?: number;
  /** Milliseconds until response headers must arrive. Defaults to `DEFAULT_RESPONSE_TIMEOUT_MS`. */
  responseTimeoutMs?: number;
  /** Milliseconds allowed between response body chunks. Defaults to `DEFAULT_STREAM_STALL_TIMEOUT_MS`. */
  streamStallTimeoutMs?: number;
  /** Milliseconds one relayed request may take in total. Defaults to `DEFAULT_REQUEST_DEADLINE_MS`. */
  requestDeadlineMs?: number;
  /** Timer seam. Tests inject counting timers; production uses real unref'd timers. */
  timers?: RelayTimers;
}

export interface LlmRelay {
  /** Sub-app that serves `/llm/runs/:runId/v1/*`. Mount it outside `/api/*`, where loopback is not trusted. */
  readonly route: Hono;
  /** Resolves a bot's model string to its provider. Throws a message the user can act on. */
  resolve(model: string): Promise<ResolvedRoute>;
  /**
   * Mints the run's bearer token. The token is 256 random bits; only its SHA-256 is kept. Issuing again for the
   * same run replaces the token.
   */
  issue(runId: string, route: ResolvedRoute): string;
  /** Invalidates the run's token. Called when the run settles. */
  revoke(runId: string): void;
  /** Called once per provider response that reported usage. Returns an unsubscribe function. */
  onUsage(listener: UsageListener): () => void;
}

interface RunEntry {
  tokenDigest: Buffer;
  route: ResolvedRoute;
}

const INVALID_BODY = Symbol('invalid body');
/** Providers such as OpenCode Go ask agents to identify themselves rather than send a generic HTTP-library name. */
const RELAY_USER_AGENT = 'brot/0.1.0';

export function createLlmRelay(options: LlmRelayOptions): LlmRelay {
  const { vault, providers } = options;
  const fetchUpstream: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const maxBytes = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
  const responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
  const streamStallTimeoutMs = options.streamStallTimeoutMs ?? DEFAULT_STREAM_STALL_TIMEOUT_MS;
  const requestDeadlineMs = options.requestDeadlineMs ?? DEFAULT_REQUEST_DEADLINE_MS;
  const timers = options.timers ?? REAL_TIMERS;
  const runs = new Map<string, RunEntry>();
  const listeners = new Set<UsageListener>();

  function emit(runId: string, route: ResolvedRoute, counts: TokenCounts): void {
    const model = route.provider.models?.find((entry) => entry.id === route.model);
    const usage: RunUsage = {
      tokensIn: counts.tokensIn,
      tokensOut: counts.tokensOut,
      costUsd: costOf(model, counts.tokensIn, counts.tokensOut),
    };
    for (const listener of [...listeners]) {
      try {
        listener(runId, usage);
      } catch (error) {
        console.error('llm usage listener failed', error);
      }
    }
  }

  async function relay(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Matched on the raw path, so an encoded or dotted segment cannot widen the endpoint allowlist.
    const match = /^\/llm\/runs\/([^/]+)\/v1\/(.+)$/.exec(url.pathname);
    if (!match) return json({ error: 'Not found' }, 404);

    const runId = decodeRunId(match[1] ?? '');
    const entry = runId === undefined ? undefined : runs.get(runId);
    if (!runId || !entry || !tokenMatches(presentedToken(request), entry.tokenDigest)) {
      return json({ error: 'Authentication required' }, 401, { 'WWW-Authenticate': 'Bearer' });
    }

    const { route } = entry;
    const endpoint = match[2] ?? '';
    const allowed = Object.hasOwn(RELAYED_ENDPOINTS[route.provider.api], endpoint)
      ? RELAYED_ENDPOINTS[route.provider.api][endpoint]
      : undefined;
    if (allowed === undefined) return json({ error: 'This endpoint is not relayed' }, 404);
    if (request.method !== allowed) return json({ error: `${endpoint} accepts ${allowed}` }, 405, { Allow: allowed });

    let body: Uint8Array<ArrayBuffer> | undefined;
    if (allowed === 'POST') {
      const read = await readCapped(request.body, maxBytes);
      if (read === undefined) return json({ error: `Request body is larger than ${maxBytes} bytes` }, 413);
      const model = requestModel(read);
      if (model === INVALID_BODY) return json({ error: 'Request body must be a JSON object' }, 400);
      if (model !== route.model) return json({ error: `This run is pinned to model "${route.model}"` }, 403);
      body = read;
    }

    const secretRef = `secret://${route.provider.secretName}`;
    let key: string | undefined;
    try {
      key = await vault.resolveRef(secretRef);
    } catch {
      console.error(`llm relay could not read ${secretRef}`);
      return json({ error: 'Brot could not read the provider secret' }, 500);
    }
    if (key === undefined) {
      return json(
        { error: `Secret "${route.provider.secretName}" is not set. Add it with PUT /api/secrets/${route.provider.secretName}.` },
        503,
      );
    }

    const headers = new Headers();
    request.headers.forEach((value, name) => {
      if (!REQUEST_DROPPED.has(name)) headers.set(name, value);
    });
    headers.set('user-agent', RELAY_USER_AGENT);
    if (route.provider.sessionHeader && route.session) headers.set(route.provider.sessionHeader, route.session);
    if (route.provider.api === 'anthropic-messages') headers.set('x-api-key', key);
    else headers.set('authorization', `Bearer ${key}`);

    const target = `${route.provider.baseUrl.replace(/\/+$/, '')}/${endpoint}${url.search}`;
    const id = route.provider.id;
    const incoming = request.signal;
    const controller = new AbortController();
    let abortReason: 'headers' | 'deadline' | undefined;
    let headersTimer: unknown;
    let deadlineTimer: unknown;

    const clearHeadersTimer = (): void => {
      if (headersTimer === undefined) return;
      timers.clearTimeout(headersTimer);
      headersTimer = undefined;
    };
    const clearDeadlineTimer = (): void => {
      if (deadlineTimer === undefined) return;
      timers.clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    };
    const detach = (): void => {
      clearHeadersTimer();
      clearDeadlineTimer();
      incoming.removeEventListener('abort', onIncomingAbort);
    };
    const abortFor = (reason: 'headers' | 'deadline'): void => {
      if (abortReason !== undefined || controller.signal.aborted) return;
      abortReason = reason;
      if (reason === 'deadline') console.error(`llm relay: provider ${id} took too long`);
      controller.abort();
    };
    function onIncomingAbort(): void {
      if (!controller.signal.aborted) controller.abort();
    }

    if (incoming.aborted) controller.abort();
    else incoming.addEventListener('abort', onIncomingAbort, { once: true });
    headersTimer = timers.setTimeout(() => abortFor('headers'), responseTimeoutMs);
    deadlineTimer = timers.setTimeout(() => abortFor('deadline'), requestDeadlineMs);

    let upstream: Response;
    try {
      upstream = await fetchUpstream(target, {
        method: request.method,
        headers,
        body,
        // A redirect would send the key to another host, so the caller gets the redirect and nothing follows it.
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      detach();
      if (abortReason === 'headers') {
        console.error(`llm relay: provider ${id} did not respond in time`);
        return json({ error: `Provider ${id} did not respond in time` }, 502);
      }
      if (abortReason === 'deadline') return json({ error: `Provider ${id} took too long` }, 502);
      if (incoming.aborted) {
        console.error(`llm relay: provider ${id} request was cancelled`);
        return json({ error: `Provider ${id} request was cancelled` }, 502);
      }
      console.error(`llm relay: provider ${id} is unreachable`, errorCode(error));
      return json({ error: `Provider ${id} is unreachable` }, 502);
    }
    clearHeadersTimer();

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, name) => {
      if (!RESPONSE_DROPPED.has(name)) responseHeaders.set(name, value);
    });
    const contentType = upstream.headers.get('content-type');
    const sink: UsageSink | undefined =
      upstream.body !== null && allowed === 'POST' && upstream.ok
        ? createUsageSink(contentType, (counts) => emit(runId, route, counts))
        : undefined;
    let stream: ReadableStream<Uint8Array> | null = upstream.body;
    if (stream === null) {
      detach();
    } else {
      stream = createGuardedBody({
        body: stream,
        signal: controller.signal,
        stallTimeoutMs: streamStallTimeoutMs,
        timers,
        stalledMessage: `Provider ${id} stalled`,
        convertError: (error) => {
          if (abortReason === 'headers') return new Error(`Provider ${id} did not respond in time`);
          if (abortReason === 'deadline') return new Error(`Provider ${id} took too long`);
          if (incoming.aborted) return new Error(`Provider ${id} request was cancelled`);
          return error instanceof Error ? error : new Error(`Provider ${id} stream failed`);
        },
        ...(sink === undefined ? {} : { sink }),
        onStall: () => {
          console.error(`llm relay: provider ${id} stalled`);
          controller.abort();
        },
        onEnd: detach,
      });
    }
    return new Response(stream, { status: upstream.status, headers: responseHeaders });
  }

  const route = new Hono();
  route.all('/llm/runs/:runId/v1/*', (c) => relay(c.req.raw));

  return {
    route,

    async resolve(model) {
      const ref = parseModelRef(model);
      const provider = providers.get(ref.provider);
      if (!provider) {
        const known = providers
          .list()
          .map((spec) => spec.id)
          .join(', ');
        throw new Error(
          `Unknown model provider "${ref.provider}" in model "${model}". Known providers: ${known}. Add one in providers.json under BROT_HOME.`,
        );
      }
      if (!(await vault.has(provider.secretName))) {
        throw new Error(
          `Model provider "${provider.id}" needs the secret "${provider.secretName}" (secret://${provider.secretName}). Add it with PUT /api/secrets/${provider.secretName}.`,
        );
      }
      const vision = provider.models?.some((entry) => entry.id === ref.model && entry.vision === true) === true;
      return { provider, model: ref.model, vision };
    },

    issue(runId, resolved) {
      const token = randomBytes(32).toString('base64url');
      runs.set(runId, { tokenDigest: sha256(token), route: resolved });
      return token;
    },

    revoke(runId) {
      runs.delete(runId);
    },

    onUsage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}


interface GuardedBodyOptions {
  body: ReadableStream<Uint8Array>;
  signal: AbortSignal;
  stallTimeoutMs: number;
  timers: RelayTimers;
  stalledMessage: string;
  /** Turns a read failure (deadline, incoming abort) into the error the client stream sees. */
  convertError(error: unknown): Error;
  /** Reports usage as chunks arrive; `finish()` is called on a normal end and on a stall. */
  sink?: UsageSink;
  /** Called once when the stall timer fires, before the stream is failed. */
  onStall(): void;
  /** Called once when the body ends, fails, stalls or is cancelled. */
  onEnd(): void;
}

/**
 * Wraps a provider response body so a silent provider cannot hang a run: each chunk resets a stall timer, and a gap
 * longer than `stallTimeoutMs` aborts the upstream request and errors the client stream. Ends, failures and
 * cancellation all clear the timer and call `onEnd`.
 */
function createGuardedBody(options: GuardedBodyOptions): ReadableStream<Uint8Array> {
  const reader = options.body.getReader();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let timer: unknown;
  let settled = false;
  let listening = false;
  let stalled = false;

  const clearStallTimer = (): void => {
    if (timer === undefined) return;
    options.timers.clearTimeout(timer);
    timer = undefined;
  };

  function stopListening(): void {
    if (!listening) return;
    options.signal.removeEventListener('abort', onAbort);
    listening = false;
  }

  function end(error?: Error, reportUsage = false): void {
    if (settled) return;
    settled = true;
    clearStallTimer();
    stopListening();
    if (reportUsage) options.sink?.finish();
    options.onEnd();
    try {
      if (error === undefined) streamController?.close();
      else streamController?.error(error);
    } catch {
      // The consumer cancelled the stream before we could end it.
    }
  }

  function onAbort(): void {
    void reader.cancel().catch(() => undefined);
    if (stalled) end(new Error(options.stalledMessage), true);
    else end(options.convertError(options.signal.reason));
  }

  const arm = (): void => {
    clearStallTimer();
    timer = options.timers.setTimeout(() => {
      timer = undefined;
      if (settled) return;
      stalled = true;
      options.onStall();
      // onStall aborts the signal, whose listener ends the stream; this covers a seam that does not abort.
      if (!settled) {
        void reader.cancel().catch(() => undefined);
        end(new Error(options.stalledMessage), true);
      }
    }, options.stallTimeoutMs);
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
      listening = true;
      void (async () => {
        for (;;) {
          if (settled) return;
          arm();
          let result: Awaited<ReturnType<typeof reader.read>>;
          try {
            result = await reader.read();
          } catch (error) {
            end(options.convertError(error));
            return;
          }
          if (settled) return;
          clearStallTimer();
          if (result.done) {
            end(undefined, true);
            return;
          }
          options.sink?.push(result.value);
          try {
            streamController?.enqueue(result.value);
          } catch {
            end();
            return;
          }
        }
      })();
    },

    cancel(reason) {
      if (settled) return;
      settled = true;
      clearStallTimer();
      stopListening();
      options.onEnd();
      void reader.cancel(reason).catch(() => undefined);
    },
  });
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** The run token, from `Authorization: Bearer` or from `x-api-key` (the header Anthropic clients send). */
function presentedToken(request: Request): string | undefined {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return bearer?.[1] ?? request.headers.get('x-api-key') ?? undefined;
}

/** Constant-time comparison of the presented token's digest with the run's stored digest. */
function tokenMatches(presented: string | undefined, expected: Buffer): boolean {
  if (presented === undefined || presented === '') return false;
  return timingSafeEqual(sha256(presented), expected);
}

function decodeRunId(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** Reads the whole body, or returns undefined once it passes `max` bytes. The read stops at the cap. */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** The body's `model` field. Undefined when it is absent or not a string; INVALID_BODY when it is not a JSON object. */
function requestModel(bytes: Uint8Array): string | undefined | typeof INVALID_BODY {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return INVALID_BODY;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return INVALID_BODY;
  const model = (parsed as { model?: unknown }).model;
  return typeof model === 'string' ? model : undefined;
}

/** A Node network error code such as `ECONNREFUSED`, found in the cause chain. Never the message, which can echo the target URL. */
function errorCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const nested = (current as { errors?: unknown }).errors;
    current = Array.isArray(nested) && nested.length > 0 ? nested[0] : (current as { cause?: unknown }).cause;
  }
  return 'unknown';
}
