import type {
  Approval,
  ApprovalDecision,
  Bot,
  CanonicalEvent,
  CreateRoomInput,
  CreateRoutineInput,
  Memory,
  Routine,
  Run,
  Task,
  Thread,
} from '@brot/protocol';

/** The server's replay page size (`REPLAY_PAGE_SIZE` in apps/server/src/app.ts). A full page means more may follow. */
const EVENT_PAGE_SIZE = 500;
const REQUEST_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: string,
  ) {
    super(`${method} ${path} failed with ${status}: ${body.slice(0, 300)}`);
    this.name = 'ApiError';
  }
}

export interface BotCreate {
  name: string;
  job: string;
  instructions?: string;
  engine: string;
  model?: string;
  computer?: 'none' | 'sandbox' | 'host';
  avatar?: string;
  egress?: { mode: 'deny'; allow: [] } | { mode: 'allowlist'; allow: string[] };
  teamBudgetUsd?: number;
}

/** A thin client for the REST API in apps/server/src/app.ts. Loopback callers need no token. */
export class BrotApi {
  constructor(
    readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    // The server refuses state-changing requests without a JSON content type, even when the body is empty.
    const writes = method === 'POST' || method === 'PUT' || method === 'PATCH';
    if (body !== undefined || writes) headers['content-type'] = 'application/json';
    const payload = body === undefined && writes ? {} : body;
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, method, path, text);
    if (text === '') return undefined as T;
    return JSON.parse(text) as T;
  }

  health(): Promise<{ ok: boolean; version: string; protocol: number }> {
    return this.request('GET', '/api/health');
  }

  engines(): Promise<Array<{ id: string; availability: { available: boolean; reason?: string } }>> {
    return this.request('GET', '/api/engines');
  }

  createBot(body: BotCreate): Promise<Bot> {
    return this.request('POST', '/api/bots', body);
  }

  archiveBot(id: string): Promise<Bot> {
    return this.request('PATCH', `/api/bots/${id}`, { archived: true });
  }

  /** Every thread the bot owns: its DM and the rooms it leads. */
  botThreads(botId: string): Promise<Thread[]> {
    return this.request('GET', `/api/bots/${botId}/threads`);
  }

  /** Rooms the bot is a member of. */
  botRooms(botId: string): Promise<Thread[]> {
    return this.request('GET', `/api/bots/${botId}/threads?kind=room`);
  }

  createThread(botId: string, title: string): Promise<Thread> {
    return this.request('POST', `/api/bots/${botId}/threads`, { title });
  }

  createRoom(input: CreateRoomInput): Promise<Thread> {
    return this.request('POST', '/api/rooms', input);
  }

  /** Posts a user message. Returns the first run's id, or null when nobody answers (rooms). */
  async postMessage(threadId: string, content: string, mentions?: string[]): Promise<string | null> {
    const body = mentions === undefined ? { content } : { content, mentions };
    const result = await this.request<{ runId: string | null }>('POST', `/api/threads/${threadId}/messages`, body);
    return result.runId;
  }

  listRuns(threadId: string): Promise<Run[]> {
    return this.request('GET', `/api/threads/${threadId}/runs`);
  }

  cancelRun(runId: string): Promise<Run> {
    return this.request('POST', `/api/runs/${runId}/cancel`);
  }

  /** The whole event log of a thread, oldest first, following the server's pages. */
  async threadEvents(threadId: string): Promise<CanonicalEvent[]> {
    const all: CanonicalEvent[] = [];
    let after: string | undefined;
    for (;;) {
      const query = after === undefined ? '' : `?after=${encodeURIComponent(after)}`;
      const page = await this.request<CanonicalEvent[]>('GET', `/api/threads/${threadId}/events${query}`);
      all.push(...page);
      const last = page.at(-1);
      if (page.length < EVENT_PAGE_SIZE || last === undefined) return all;
      after = last.id;
    }
  }

  approvals(status?: 'pending' | 'allowed' | 'denied'): Promise<Approval[]> {
    const query = status === undefined ? '' : `?status=${status}`;
    return this.request('GET', `/api/approvals${query}`);
  }

  resolveApproval(id: string, decision: ApprovalDecision, reply?: string): Promise<Approval> {
    const body = reply === undefined ? { decision } : { decision, reply };
    return this.request('POST', `/api/approvals/${id}`, body);
  }

  listTasks(query: { assigneeBotId?: string; threadId?: string; chainId?: string }): Promise<Task[]> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
    const suffix = params.size === 0 ? '' : `?${params.toString()}`;
    return this.request('GET', `/api/tasks${suffix}`);
  }

  createRoutine(input: CreateRoutineInput): Promise<Routine> {
    return this.request('POST', '/api/routines', input);
  }

  async runRoutine(id: string): Promise<{ runId: string }> {
    return this.request('POST', `/api/routines/${id}/run`);
  }

  listMemories(botId: string): Promise<Memory[]> {
    return this.request('GET', `/api/bots/${botId}/memories`);
  }

  patchMemory(id: string, content: string): Promise<Memory> {
    return this.request('PATCH', `/api/memories/${id}`, { content });
  }

  /** The server lists secret names only, never values. */
  listSecrets(): Promise<string[]> {
    return this.request('GET', '/api/secrets');
  }

  async putSecret(name: string, value: string): Promise<void> {
    await this.request('PUT', `/api/secrets/${encodeURIComponent(name)}`, { value });
  }

  async deleteSecret(name: string): Promise<void> {
    await this.request('DELETE', `/api/secrets/${encodeURIComponent(name)}`);
  }
}
