import {
  Approval,
  Bot,
  CanonicalEvent,
  CreateRoom,
  CreateTask,
  Message,
  PostMessage,
  ResolveApproval,
  RoomMember,
  Run,
  Task,
  Thread,
  UpdateTask,
  type CanonicalEventType,
} from '@brot/protocol';
import type { BotEvent, BrotClient, Room, TaskFilter } from './client';

/** The slice of EventSource this client uses. The browser's EventSource satisfies it; tests pass a fake. */
export interface EventStream {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventStreamFactory = new (url: string) => EventStream;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  /** Prefix for every request. Empty means same origin, where the dev proxy and the built app serve /api. */
  baseUrl?: string;
  fetch?: FetchLike;
  EventSource?: EventStreamFactory;
}

/**
 * The server names each SSE frame by its event type, and EventSource only delivers named frames to
 * listeners registered for that name, so every type needs a listener. The Record turns a missing
 * type into a compile error when the protocol adds one.
 */
const EVENT_NAMES: Record<CanonicalEventType, true> = {
  'run.started': true,
  'message.delta': true,
  'message.completed': true,
  'tool.call': true,
  'tool.result': true,
  'approval.requested': true,
  'approval.resolved': true,
  'memory.written': true,
  'cost.updated': true,
  'computer.status': true,
  'computer.takeover': true,
  'network.blocked': true,
  'task.created': true,
  'task.updated': true,
  'handoff': true,
  'bot.asked': true,
  'bot.answered': true,
  'room.members': true,
  'run.completed': true,
  'run.failed': true,
};

/**
 * Talks to a running Brot server over its /api routes (docs/TEAM-API.md). Each bot maps to its DM:
 * the first `kind=dm` thread the server lists, cached for the session. Reads never create threads;
 * the first postMessage creates one when a bot has none. Rooms are their own threads.
 */
export function createHttpClient({
  baseUrl = '',
  fetch = globalThis.fetch,
  EventSource = globalThis.EventSource,
}: HttpClientOptions = {}): BrotClient {
  const root = baseUrl.replace(/\/$/, '');
  const knownBots = new Set<string>();
  const threadOfBot = new Map<string, string>();
  const botOfThread = new Map<string, string>();
  const creatingThread = new Map<string, Promise<string>>();
  const roomIds = new Set<string>();
  const listeners = new Set<(event: BotEvent) => void>();
  let roomsLoaded: Promise<void> | undefined;
  let stream: EventStream | undefined;
  let delivery: Promise<void> = Promise.resolve();

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${root}${path}`, init);
    if (!response.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${await describeFailure(response)}`);
    }
    return response;
  }

  async function read<T>(path: string, schema: { parse(value: unknown): T }): Promise<T> {
    const response = await request(path, { headers: { Accept: 'application/json' } });
    return schema.parse(await response.json());
  }

  function write(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<Response> {
    return request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function remember(botId: string, threadId: string): string {
    threadOfBot.set(botId, threadId);
    botOfThread.set(threadId, botId);
    return threadId;
  }

  async function findThread(botId: string): Promise<string | undefined> {
    const cached = threadOfBot.get(botId);
    if (cached !== undefined) return cached;
    const threads = await read(`/api/bots/${encodeURIComponent(botId)}/threads?kind=dm`, Thread.array());
    const first = threads.find((thread) => (thread.kind ?? 'dm') === 'dm');
    return first === undefined ? undefined : remember(botId, first.id);
  }

  async function createPrimaryThread(botId: string): Promise<string> {
    const existing = await findThread(botId);
    if (existing !== undefined) return existing;
    const response = await write('POST', `/api/bots/${encodeURIComponent(botId)}/threads`, {});
    return remember(botId, Thread.parse(await response.json()).id);
  }

  /** Returns the bot's primary thread, creating it on first use. Concurrent callers share one creation. */
  function ensureThread(botId: string): Promise<string> {
    const cached = threadOfBot.get(botId);
    if (cached !== undefined) return Promise.resolve(cached);
    let pending = creatingThread.get(botId);
    if (pending === undefined) {
      pending = createPrimaryThread(botId).finally(() => creatingThread.delete(botId));
      creatingThread.set(botId, pending);
    }
    return pending;
  }

  async function fetchRooms(): Promise<Room[]> {
    const threads = await read('/api/rooms', Thread.array());
    const rooms = await Promise.all(
      threads.map(async (thread) => {
        roomIds.add(thread.id);
        const members = await read(`/api/rooms/${encodeURIComponent(thread.id)}/members`, RoomMember.array());
        return { thread, memberIds: members.map((member) => member.botId) };
      }),
    );
    return rooms;
  }

  /**
   * Maps a live event's thread to its conversation. A thread the client has not seen yet (created on
   * another device, or by a routine) gets one lookup of the bots' DMs and one of the rooms.
   */
  async function targetOf(threadId: string): Promise<{ botId: string } | { roomId: string } | undefined> {
    const known = botOfThread.get(threadId);
    if (known !== undefined) return { botId: known };
    if (roomIds.has(threadId)) return { roomId: threadId };
    await Promise.all(
      [...knownBots]
        .filter((botId) => !threadOfBot.has(botId))
        .map((botId) => findThread(botId).catch(() => undefined)),
    );
    const found = botOfThread.get(threadId);
    if (found !== undefined) return { botId: found };
    if (roomsLoaded !== undefined) {
      await fetchRooms().catch(() => undefined);
      if (roomIds.has(threadId)) return { roomId: threadId };
    }
    return undefined;
  }

  /**
   * A thread's events: the server's event log when it has one, else a replay of its records. Only a
   * 404 falls back, so a real failure still surfaces.
   */
  async function threadEvents(threadId: string): Promise<CanonicalEvent[]> {
    const path = `/api/threads/${encodeURIComponent(threadId)}`;
    const response = await fetch(`${root}${path}/events`, { headers: { Accept: 'application/json' } });
    if (response.ok) return CanonicalEvent.array().parse(await response.json());
    if (response.status !== 404) {
      throw new Error(`GET ${path}/events failed: ${await describeFailure(response)}`);
    }
    const [messages, runs, approvals] = await Promise.all([
      read(`${path}/messages`, Message.array()),
      read(`${path}/runs`, Run.array()),
      read('/api/approvals', Approval.array()),
    ]);
    return replay({
      threadId,
      messages,
      runs,
      approvals: approvals.filter((approval) => approval.threadId === threadId),
    });
  }

  /** Events are delivered in arrival order, even when a thread lookup is needed first. */
  function receive(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      console.warn('Dropped a server event that is not JSON');
      return;
    }
    const result = CanonicalEvent.safeParse(parsed);
    if (!result.success) {
      console.warn('Dropped a server event that does not match the protocol', result.error.issues);
      return;
    }
    const event = result.data;
    delivery = delivery
      .then(async () => {
        const target = await targetOf(event.threadId);
        const isTask = event.type === 'task.created' || event.type === 'task.updated';
        if (target === undefined && !isTask) return;
        const item: BotEvent = { ...target, event };
        for (const listener of [...listeners]) listener(item);
      })
      .catch((error: unknown) => {
        console.error('Event delivery failed', error);
      });
  }

  function openStream(): EventStream {
    const source = new EventSource(`${root}/api/events`);
    for (const name of Object.keys(EVENT_NAMES)) {
      source.addEventListener(name, (message) => receive(message.data));
    }
    return source;
  }

  return {
    async listBots() {
      const bots = await read('/api/bots', Bot.array());
      for (const bot of bots) knownBots.add(bot.id);
      return bots;
    },

    async history(botId) {
      const threadId = await findThread(botId);
      if (threadId === undefined) return [];
      return threadEvents(threadId);
    },

    onEvent(listener) {
      listeners.add(listener);
      stream ??= openStream();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stream?.close();
          stream = undefined;
        }
      };
    },

    async postMessage(botId, input) {
      const body = PostMessage.parse(input);
      const threadId = await ensureThread(botId);
      await write('POST', `/api/threads/${encodeURIComponent(threadId)}/messages`, body);
    },

    async resolveApproval(approvalId, input) {
      const body = ResolveApproval.parse(input);
      const response = await write('POST', `/api/approvals/${encodeURIComponent(approvalId)}`, body);
      Approval.parse(await response.json());
    },

    listRooms() {
      const pending = fetchRooms();
      roomsLoaded = pending.then(() => undefined, () => undefined);
      return pending;
    },

    async createRoom(input) {
      const body = CreateRoom.parse(input);
      const response = await write('POST', '/api/rooms', body);
      const thread = Thread.parse(await response.json());
      roomIds.add(thread.id);
      return { thread, memberIds: [...body.botIds] };
    },

    roomHistory(roomId) {
      roomIds.add(roomId);
      return threadEvents(roomId);
    },

    async postRoomMessage(roomId, input) {
      const body = PostMessage.parse(input);
      await write('POST', `/api/threads/${encodeURIComponent(roomId)}/messages`, {
        content: body.content,
        ...(body.mentions?.length ? { mentions: body.mentions } : {}),
      });
    },

    listTasks(filter: TaskFilter = {}) {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(filter)) if (value !== undefined) query.set(name, value);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return read(`/api/tasks${suffix}`, Task.array());
    },

    async createTask(input) {
      const threadId = input.roomId ?? (await ensureThread(input.assigneeBotId));
      const body = CreateTask.parse({
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        assigneeBotId: input.assigneeBotId,
        threadId,
      });
      const response = await write('POST', '/api/tasks', body);
      return Task.parse(await response.json());
    },

    async cancelTask(taskId) {
      const body = UpdateTask.parse({ status: 'cancelled' });
      const response = await write('PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, body);
      return Task.parse(await response.json());
    },
  };
}

async function describeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      return `${response.status} ${body.error}`;
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `${response.status} ${response.statusText}`.trim();
}

interface HistoryRecords {
  threadId: string;
  messages: Message[];
  runs: Run[];
  approvals: Approval[];
}

/**
 * Rebuilds a thread's canonical events from the records the server exposes. The server has no JSON
 * route for the event log, so tool calls, streamed deltas and memories do not come back on reload.
 * Messages, run boundaries, run costs and approvals do. Event ids are derived from record ids, so a
 * reload yields the same ids every time.
 */
function replay({ threadId, messages, runs, approvals }: HistoryRecords): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  for (const message of messages) {
    events.push({
      id: `history:message:${message.id}`,
      at: message.createdAt,
      threadId,
      type: 'message.completed',
      message,
    });
  }

  for (const run of runs) {
    const endedAt = run.endedAt ?? run.startedAt;
    const key = `history:run:${run.id}`;
    events.push({
      id: `${key}:started`,
      at: run.startedAt,
      threadId,
      runId: run.id,
      type: 'run.started',
      botId: run.botId,
      engine: run.engine,
      model: run.model,
    });
    events.push({
      id: `${key}:cost`,
      at: endedAt,
      threadId,
      runId: run.id,
      type: 'cost.updated',
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costUsd,
    });
    if (run.status === 'completed') {
      events.push({ id: `${key}:completed`, at: endedAt, threadId, runId: run.id, type: 'run.completed' });
    } else if (run.status === 'failed' || run.status === 'cancelled') {
      // The live path reports cancellation as run.failed, so history does the same.
      const fallback = run.status === 'cancelled' ? 'Run cancelled.' : 'Run failed.';
      events.push({
        id: `${key}:failed`,
        at: endedAt,
        threadId,
        runId: run.id,
        type: 'run.failed',
        error: run.error ?? fallback,
      });
    }
  }

  for (const approval of approvals) {
    const key = `history:approval:${approval.id}`;
    const requested: Approval = {
      id: approval.id,
      runId: approval.runId,
      threadId: approval.threadId,
      botId: approval.botId,
      kind: approval.kind,
      tool: approval.tool,
      summary: approval.summary,
      args: approval.args,
      status: 'pending',
      createdAt: approval.createdAt,
    };
    events.push({
      id: `${key}:requested`,
      at: approval.createdAt,
      threadId,
      runId: approval.runId,
      type: 'approval.requested',
      approval: requested,
    });
    if (approval.status !== 'pending') {
      events.push({
        id: `${key}:resolved`,
        at: approval.resolvedAt ?? approval.createdAt,
        threadId,
        runId: approval.runId,
        type: 'approval.resolved',
        approval,
      });
    }
  }

  // Array.prototype.sort is stable, so records sharing a timestamp keep the order pushed above.
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
