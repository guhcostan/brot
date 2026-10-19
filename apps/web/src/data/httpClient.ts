import {
  Approval,
  Bot,
  CanonicalEvent,
  Message,
  PostMessage,
  ResolveApproval,
  Run,
  Thread,
  type CanonicalEventType,
} from '@brot/protocol';
import type { BotEvent, BrotClient } from './client';

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
  'run.completed': true,
  'run.failed': true,
};

/**
 * Talks to a running Brot server over its /api routes. The web app is bot-centric, so each bot maps
 * to its primary thread: the first thread the server lists, cached for the session. Reads never
 * create threads; the first postMessage creates one when a bot has none.
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
  const listeners = new Set<(event: BotEvent) => void>();
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

  function write(method: 'POST', path: string, body: unknown): Promise<Response> {
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
    const [first] = await read(`/api/bots/${encodeURIComponent(botId)}/threads`, Thread.array());
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

  /**
   * Maps a live event's thread to its bot. A bot whose thread the client has not seen yet (created on
   * another device, or by a routine) gets one lookup before the event is dropped.
   */
  async function botOf(threadId: string): Promise<string | undefined> {
    const known = botOfThread.get(threadId);
    if (known !== undefined) return known;
    await Promise.all(
      [...knownBots]
        .filter((botId) => !threadOfBot.has(botId))
        .map((botId) => findThread(botId).catch(() => undefined)),
    );
    return botOfThread.get(threadId);
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
        const botId = await botOf(event.threadId);
        if (botId === undefined) return;
        for (const listener of [...listeners]) listener({ botId, event });
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
      const path = `/api/threads/${encodeURIComponent(threadId)}`;
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
