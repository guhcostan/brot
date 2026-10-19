import {
  Approval,
  ApprovalStatus,
  Bot,
  CreateThread,
  Message,
  PairingComplete,
  PairingCompleteResponse,
  PostMessage,
  ResolveApproval,
  Run,
  Thread,
  type ApprovalDecision,
} from '@brot/protocol';
import { z } from 'zod';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The parts of a server reply the app acts on. `status` 0 means the request never got an answer. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }

  get forbidden(): boolean {
    return this.status === 403;
  }
}

export const Health = z.object({ ok: z.boolean(), version: z.string(), protocol: z.number() });
export type Health = z.infer<typeof Health>;

const RunAccepted = z.object({ runId: z.string() });

export interface ClientOptions {
  baseUrl: string;
  /** Device token from pairing. Sent as a bearer token, which is what the server's authenticate middleware reads. */
  token?: string;
  fetch?: FetchLike;
}

export interface BrotClient {
  readonly baseUrl: string;
  health(): Promise<Health>;
  listBots(): Promise<Bot[]>;
  getBot(botId: string): Promise<Bot>;
  listThreads(botId: string): Promise<Thread[]>;
  createThread(botId: string, input?: CreateThread): Promise<Thread>;
  listMessages(threadId: string): Promise<Message[]>;
  listRuns(threadId: string): Promise<Run[]>;
  listApprovals(status?: ApprovalStatus): Promise<Approval[]>;
  postMessage(threadId: string, content: string): Promise<{ runId: string }>;
  cancelRun(runId: string): Promise<Run>;
  resolveApproval(approvalId: string, decision: ApprovalDecision, reply?: string): Promise<Approval>;
  removeDevice(deviceId: string): Promise<void>;
  /** URL and headers for the live event stream. `after` replays stored events newer than that timestamp. */
  eventStream(params?: { threadId?: string; after?: string }): { url: string; headers: Record<string, string> };
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

async function failure(response: Response, method: string, path: string): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let reason = `${response.status} ${response.statusText}`.trim();
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      reason = body.error;
    }
  } catch {
    // Not JSON: keep the status line.
  }
  return new ApiError(`${method} ${path}: ${reason}`, response.status, path);
}

async function send(
  fetcher: FetchLike,
  root: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit = { method, headers: { Accept: 'application/json', ...headers } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetcher(`${root}${path}`, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ApiError(`${method} ${path}: ${reason}`, 0, path);
  }
  if (!response.ok) throw await failure(response, method, path);
  return response;
}

async function parse<T>(response: Response, schema: z.ZodType<T>, path: string): Promise<T> {
  const result = schema.safeParse(await response.json());
  if (!result.success) {
    throw new ApiError(`${path}: the server replied with an unexpected shape (${result.error.issues.length} issues)`, response.status, path);
  }
  return result.data;
}

export function createClient({ baseUrl, token, fetch: fetcher = globalThis.fetch }: ClientOptions): BrotClient {
  const root = normalizeBaseUrl(baseUrl);
  const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const get = async <T>(path: string, schema: z.ZodType<T>): Promise<T> =>
    parse(await send(fetcher, root, 'GET', path, auth), schema, path);

  const post = async <T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> =>
    parse(await send(fetcher, root, 'POST', path, auth, body), schema, path);

  return {
    baseUrl: root,
    health: () => get('/api/health', Health),
    listBots: () => get('/api/bots', Bot.array()),
    getBot: (botId) => get(`/api/bots/${enc(botId)}`, Bot),
    listThreads: (botId) => get(`/api/bots/${enc(botId)}/threads`, Thread.array()),
    createThread: async (botId, input = {}) => post(`/api/bots/${enc(botId)}/threads`, CreateThread.parse(input), Thread),
    listMessages: (threadId) => get(`/api/threads/${enc(threadId)}/messages`, Message.array()),
    listRuns: (threadId) => get(`/api/threads/${enc(threadId)}/runs`, Run.array()),
    listApprovals: async (status) =>
      get(status ? `/api/approvals?status=${enc(ApprovalStatus.parse(status))}` : '/api/approvals', Approval.array()),
    postMessage: async (threadId, content) =>
      post(`/api/threads/${enc(threadId)}/messages`, PostMessage.parse({ content }), RunAccepted),
    cancelRun: (runId) => post(`/api/runs/${enc(runId)}/cancel`, {}, Run),
    resolveApproval: async (approvalId, decision, reply) =>
      post(`/api/approvals/${enc(approvalId)}`, ResolveApproval.parse({ decision, reply }), Approval),
    async removeDevice(deviceId) {
      await send(fetcher, root, 'DELETE', `/api/devices/${enc(deviceId)}`, auth);
    },
    eventStream({ threadId, after } = {}) {
      const query = new URLSearchParams();
      if (threadId) query.set('threadId', threadId);
      if (after) query.set('after', after);
      const qs = query.toString();
      return {
        url: `${root}/api/events${qs ? `?${qs}` : ''}`,
        headers: { Accept: 'text/event-stream', ...auth },
      };
    },
  };
}

/** Trades a scanned pairing token for a long-lived device token. The only unauthenticated write the server accepts. */
export async function completePairing(
  baseUrl: string,
  input: z.input<typeof PairingComplete>,
  fetcher: FetchLike = globalThis.fetch,
): Promise<PairingCompleteResponse> {
  const path = '/api/pairing/complete';
  const response = await send(fetcher, normalizeBaseUrl(baseUrl), 'POST', path, {}, PairingComplete.parse(input));
  return parse(response, PairingCompleteResponse, path);
}
