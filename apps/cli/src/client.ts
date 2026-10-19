import { Bot, CanonicalEvent, Thread } from '@brot/protocol';
import { z } from 'zod';
import { parseSse } from './sse';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const Health = z.object({
  ok: z.literal(true),
  version: z.string(),
  protocol: z.number().int(),
});
export type Health = z.infer<typeof Health>;

const RunAccepted = z.object({ runId: z.string() });
const ErrorBody = z.object({ error: z.string() });

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class ServerUnreachableError extends Error {
  readonly baseUrl: string;

  constructor(baseUrl: string, cause: unknown) {
    super(`No Brot server answered at ${baseUrl}. Start one with "brot serve" or pass --url.`, { cause });
    this.name = 'ServerUnreachableError';
    this.baseUrl = baseUrl;
  }
}

export interface EventQuery {
  threadId: string;
  /** ISO timestamp. The server replays stored events strictly after it, then streams live ones. */
  after?: string;
  signal: AbortSignal;
  onInvalidEvent?: (data: string) => void;
}

interface Exchange {
  body?: unknown;
  signal?: AbortSignal;
  accept?: string;
}

/** Typed client for the Brot HTTP API. Every response is validated with a zod schema before use. */
export class BrotClient {
  readonly baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(baseUrl: string, fetchImpl: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.#fetch = fetchImpl;
  }

  health(signal?: AbortSignal): Promise<Health> {
    return this.getJson('/api/health', Health, { signal });
  }

  /** Resolves to undefined when the bot does not exist. */
  async getBot(botId: string): Promise<Bot | undefined> {
    const response = await this.exchange('GET', `/api/bots/${encodeURIComponent(botId)}`, {});
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    return this.parse(response, `/api/bots/${botId}`, Bot);
  }

  listThreads(botId: string): Promise<Thread[]> {
    return this.getJson(`/api/bots/${encodeURIComponent(botId)}/threads`, z.array(Thread), {});
  }

  createThread(botId: string): Promise<Thread> {
    return this.post(`/api/bots/${encodeURIComponent(botId)}/threads`, {}, Thread);
  }

  startRun(threadId: string, content: string): Promise<{ runId: string }> {
    return this.post(`/api/threads/${encodeURIComponent(threadId)}/messages`, { content }, RunAccepted);
  }

  /** Yields validated canonical events. Invalid payloads are reported through `onInvalidEvent` and skipped. */
  async *events(query: EventQuery): AsyncGenerator<CanonicalEvent> {
    const params = new URLSearchParams({ threadId: query.threadId });
    if (query.after !== undefined) params.set('after', query.after);
    const path = '/api/events';
    const response = await this.exchange('GET', `${path}?${params.toString()}`, {
      signal: query.signal,
      accept: 'text/event-stream',
    });
    if (!response.ok) throw new ApiError(await failureMessage(response, path), response.status);
    if (response.body === null) throw new ApiError(`${path} returned no stream`, response.status);

    for await (const message of parseSse(response.body)) {
      const parsed = parseEventData(message.data);
      if (parsed) yield parsed;
      else query.onInvalidEvent?.(message.data);
    }
  }

  private getJson<T>(path: string, schema: z.ZodType<T>, options: Exchange): Promise<T> {
    return this.exchange('GET', path, options).then((response) => this.parse(response, path, schema));
  }

  private post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.exchange('POST', path, { body }).then((response) => this.parse(response, path, schema));
  }

  private async exchange(method: 'GET' | 'POST', path: string, options: Exchange): Promise<Response> {
    const headers: Record<string, string> = { accept: options.accept ?? 'application/json' };
    const init: RequestInit = { method, headers, signal: options.signal };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    try {
      return await this.#fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new ServerUnreachableError(this.baseUrl, error);
    }
  }

  private async parse<T>(response: Response, path: string, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) throw new ApiError(await failureMessage(response, path), response.status);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(`${path} did not return JSON`, response.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new ApiError(`${path} returned an unexpected shape (${problems})`, response.status);
    }
    return parsed.data;
  }
}

function parseEventData(data: string): CanonicalEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  const parsed = CanonicalEvent.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function failureMessage(response: Response, path: string): Promise<string> {
  const text = await response.text().catch(() => '');
  let detail: string | undefined;
  try {
    const parsed = ErrorBody.safeParse(JSON.parse(text));
    if (parsed.success) detail = parsed.data.error;
  } catch {
    detail = undefined;
  }
  return detail ? `${path} failed (HTTP ${response.status}): ${detail}` : `${path} failed (HTTP ${response.status})`;
}
