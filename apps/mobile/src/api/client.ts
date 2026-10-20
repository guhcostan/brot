import {
  Approval,
  ApprovalStatus,
  Bot,
  CanonicalEvent,
  ComputerInput,
  ComputerState,
  CreateThread,
  Message,
  PairingComplete,
  PairingCompleteResponse,
  PostMessage,
  ResolveApproval,
  RoomMember,
  Run,
  SetTakeover,
  Takeover,
  Task,
  TaskStatus,
  Thread,
  type ApprovalDecision,
  type ThreadKind,
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

/** In a room `runId` is the first responder's run, or null when nobody answers. */
const RunAccepted = z.object({ runId: z.string().nullable() });

/** `GET /api/bots/:id/computer` (docs/COMPUTER-USE.md). */
export const ComputerInfo = z.object({
  state: z.union([ComputerState, z.literal('none')]),
  desktop: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  takeover: Takeover.nullable(),
});
export type ComputerInfo = z.infer<typeof ComputerInfo>;

/** One poll of the live screen. `none`: the bot has no desktop (404). `stopped`: the computer is not running (409). */
export type ScreenFrame = { kind: 'frame'; uri: string } | { kind: 'none' } | { kind: 'stopped' };

export interface TaskQuery {
  assigneeBotId?: string;
  status?: TaskStatus;
  chainId?: string;
  threadId?: string;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** RFC 4648 base64 with padding. React Native has no Buffer or btoa for binary data. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64[a >> 2]!;
    out += BASE64[((a & 0b11) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : BASE64[((b & 0b1111) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : BASE64[c & 0b111111]!;
  }
  return out;
}

interface FileReaderLike {
  result: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsDataURL(blob: Blob): void;
}

/** A JPEG body as a data URI. Prefers arrayBuffer; React Native builds without it fall back to FileReader. */
async function jpegDataUri(response: Response): Promise<string> {
  const copy = response.clone();
  try {
    return `data:image/jpeg;base64,${toBase64(new Uint8Array(await response.arrayBuffer()))}`;
  } catch {
    const blob = await copy.blob();
    const Reader = (globalThis as { FileReader?: new () => FileReaderLike }).FileReader;
    if (!Reader) throw new Error('No way to read the screen image');
    return new Promise((resolve, reject) => {
      const reader = new Reader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*/, 'data:image/jpeg'));
      reader.onerror = () => reject(new Error('Could not read the screen image'));
      reader.readAsDataURL(blob);
    });
  }
}

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
  /** A bot's threads. `kind: 'dm'` returns only its DM; `room` the rooms it belongs to. */
  listThreads(botId: string, kind?: ThreadKind): Promise<Thread[]>;
  listRooms(): Promise<Thread[]>;
  listRoomMembers(threadId: string): Promise<RoomMember[]>;
  /** The thread's stored event log, oldest first, one page. `after` is an event id. */
  listEvents(threadId: string, after?: string): Promise<CanonicalEvent[]>;
  listTasks(query?: TaskQuery): Promise<Task[]>;
  getComputer(botId: string): Promise<ComputerInfo>;
  startComputer(botId: string): Promise<ComputerInfo>;
  /** One frame of the bot's desktop. */
  screen(botId: string): Promise<ScreenFrame>;
  setTakeover(botId: string, input: SetTakeover): Promise<Takeover>;
  sendInput(botId: string, input: ComputerInput): Promise<void>;
  createThread(botId: string, input?: CreateThread): Promise<Thread>;
  listMessages(threadId: string): Promise<Message[]>;
  listRuns(threadId: string): Promise<Run[]>;
  listApprovals(status?: ApprovalStatus): Promise<Approval[]>;
  postMessage(threadId: string, content: string, mentions?: string[]): Promise<{ runId: string | null }>;
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
    listThreads: (botId, kind) => get(`/api/bots/${enc(botId)}/threads${kind ? `?kind=${enc(kind)}` : ''}`, Thread.array()),
    listRooms: () => get('/api/rooms', Thread.array()),
    listRoomMembers: (threadId) => get(`/api/rooms/${enc(threadId)}/members`, RoomMember.array()),
    listEvents: (threadId, after) =>
      get(`/api/threads/${enc(threadId)}/events${after ? `?after=${enc(after)}` : ''}`, CanonicalEvent.array()),
    listTasks: (query = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
      const qs = params.toString();
      return get(`/api/tasks${qs ? `?${qs}` : ''}`, Task.array());
    },
    getComputer: (botId) => get(`/api/bots/${enc(botId)}/computer`, ComputerInfo),
    startComputer: (botId) => post(`/api/bots/${enc(botId)}/computer/start`, {}, ComputerInfo),
    async screen(botId) {
      const path = `/api/bots/${enc(botId)}/computer/screen`;
      let response: Response;
      try {
        response = await fetcher(`${root}${path}`, { method: 'GET', headers: { Accept: 'image/jpeg', ...auth }, cache: 'no-store' });
      } catch (error) {
        throw new ApiError(`GET ${path}: ${error instanceof Error ? error.message : String(error)}`, 0, path);
      }
      if (response.status === 404) return { kind: 'none' };
      if (response.status === 409) return { kind: 'stopped' };
      if (!response.ok) throw await failure(response, 'GET', path);
      return { kind: 'frame', uri: await jpegDataUri(response) };
    },
    setTakeover: (botId, input) => post(`/api/bots/${enc(botId)}/computer/takeover`, SetTakeover.parse(input), Takeover),
    async sendInput(botId, input) {
      await send(fetcher, root, 'POST', `/api/bots/${enc(botId)}/computer/input`, auth, ComputerInput.parse(input));
    },
    createThread: async (botId, input = {}) => post(`/api/bots/${enc(botId)}/threads`, CreateThread.parse(input), Thread),
    listMessages: (threadId) => get(`/api/threads/${enc(threadId)}/messages`, Message.array()),
    listRuns: (threadId) => get(`/api/threads/${enc(threadId)}/runs`, Run.array()),
    listApprovals: async (status) =>
      get(status ? `/api/approvals?status=${enc(ApprovalStatus.parse(status))}` : '/api/approvals', Approval.array()),
    postMessage: async (threadId, content, mentions) =>
      post(
        `/api/threads/${enc(threadId)}/messages`,
        PostMessage.parse(mentions && mentions.length > 0 ? { content, mentions } : { content }),
        RunAccepted,
      ),
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
