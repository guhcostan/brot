import type { Approval, Bot, CanonicalEvent, Message, Run, Task, Thread } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotEvent } from './client';
import { createHttpClient, type EventStream, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';
const later = (seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: true,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const thread = (id: string, botId = 'bot_1'): Thread => ({
  id,
  botId,
  title: 'New thread',
  createdAt: at,
  updatedAt: at,
});

interface Call {
  method: string;
  url: string;
  path: string;
  search: string;
  headers: Headers;
  body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Records every request and answers with whatever `respond` returns for it. A thread's event log
 * answers 404, like a server without that route, unless `eventLog` is set.
 */
function fakeFetch(respond: (call: Call) => Response, { eventLog = false }: { eventLog?: boolean } = {}) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      url: input,
      path: url.pathname,
      search: url.search,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    if (!eventLog && /^\/api\/threads\/[^/]+\/events$/.test(call.path)) return json({ error: 'not found' }, 404);
    return respond(call);
  };
  return { fetch, calls };
}

class FakeEventSource implements EventStream {
  static created: FakeEventSource[] = [];
  closed = false;
  private readonly handlers = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.created.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** Dispatches a frame the way the browser does: to listeners registered under the frame's name. */
  send(type: string, data: string): void {
    for (const listener of this.handlers.get(type) ?? []) {
      listener(new MessageEvent<string>(type, { data }));
    }
  }

  listenerNames(): string[] {
    return [...this.handlers.keys()];
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function messageCompleted(id: string, content: string): CanonicalEvent {
  return {
    id,
    at,
    threadId: 'thr_1',
    type: 'message.completed',
    message: { id: `msg_${id}`, threadId: 'thr_1', role: 'assistant', content, createdAt: at },
  };
}

beforeEach(() => {
  FakeEventSource.created = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listBots and errors', () => {
  it('lists bots from GET /api/bots', async () => {
    const { fetch, calls } = fakeFetch(() => json([bot]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.listBots()).resolves.toEqual([bot]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/bots' });
    expect(calls[0]?.headers.get('Accept')).toBe('application/json');
  });

  it('rejects a bot list that does not match the protocol', async () => {
    const { fetch } = fakeFetch(() => json([{ id: 'bot_1' }]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.listBots()).rejects.toThrow();
  });

  it('surfaces the server error message with the status', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Host header is not a loopback address' }, 403));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.listBots()).rejects.toThrow('403 Host header is not a loopback address');
  });

  it('joins baseUrl without doubling the slash, for requests and the event stream', async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const client = createHttpClient({ baseUrl: 'http://127.0.0.1:8799/', fetch, EventSource: FakeEventSource });

    await client.listBots();
    client.onEvent(() => undefined);

    expect(calls[0]?.url).toBe('http://127.0.0.1:8799/api/bots');
    expect(FakeEventSource.created[0]?.url).toBe('http://127.0.0.1:8799/api/events');
  });
});

describe('listProviders', () => {
  const provider = (id: string, models: Array<{ id: string; label?: string }>) => ({
    id,
    label: 'OpenCode Go',
    configured: true,
    secretName: 'OPENCODE_API_KEY',
    models,
  });

  it('composes each model id as provider/model, the ref the bot model field expects', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json([provider('opencode-go', [{ id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }])]),
    );
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const [parsed] = await client.listProviders();

    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/providers' });
    expect(parsed?.models).toEqual([{ id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }]);
  });

  it('joins once when the model id itself contains a slash, and falls back to the bare model id for the label', async () => {
    const { fetch } = fakeFetch(() => json([provider('openrouter', [{ id: 'meta-llama/Llama-3' }])]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const [parsed] = await client.listProviders();

    expect(parsed?.models).toEqual([{ id: 'openrouter/meta-llama/Llama-3', label: 'meta-llama/Llama-3' }]);
  });
});

describe('threads', () => {
  it('lists a bot DM threads', async () => {
    const { fetch, calls } = fakeFetch(() => json([thread('thr_2'), thread('thr_1')]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.listThreads('bot_1')).resolves.toEqual([thread('thr_2'), thread('thr_1')]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/bots/bot_1/threads', search: '?kind=dm' });
  });

  it('creates a thread with an optional title and posts the body as JSON', async () => {
    const { fetch, calls } = fakeFetch(() => json(thread('thr_9'), 201));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.createThread('bot_1', { title: 'Planning' })).resolves.toEqual(thread('thr_9'));
    await client.createThread('bot_1');

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /api/bots/bot_1/threads', 'POST /api/bots/bot_1/threads']);
    expect(calls[0]?.body).toEqual({ title: 'Planning' });
    expect(calls[1]?.body).toEqual({});
  });

  it('renames a thread with PATCH and rejects an empty title before any request', async () => {
    const renamed = { ...thread('thr_1'), title: 'Planning' };
    const { fetch, calls } = fakeFetch(() => json(renamed));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.updateThread('thr_1', { title: 'Planning' })).resolves.toEqual(renamed);
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/threads/thr_1', body: { title: 'Planning' } });

    await expect(client.updateThread('thr_1', { title: '' })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('reads a thread event log through its id', async () => {
    const event = messageCompleted('evt_log', 'From the log');
    const { fetch, calls } = fakeFetch((call) => (call.path === '/api/threads/thr_1/events' ? json([event]) : json([])), { eventLog: true });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.history('thr_1')).resolves.toEqual([event]);
    expect(calls.map((call) => call.path)).toEqual(['/api/threads/thr_1/events']);
  });

  it('surfaces an event log failure other than 404 instead of replaying', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'boom' }, 500), { eventLog: true });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.history('thr_1')).rejects.toThrow('500 boom');
  });

  it('rebuilds messages, runs, approvals and costs in time order', async () => {
    const userMessage: Message = { id: 'msg_u', threadId: 'thr_1', role: 'user', content: 'Hi', createdAt: at };
    const reply: Message = {
      id: 'msg_a',
      threadId: 'thr_1',
      role: 'assistant',
      content: 'Hello',
      createdAt: later(4),
    };
    const run: Run = {
      id: 'run_1',
      threadId: 'thr_1',
      botId: 'bot_1',
      status: 'completed',
      engine: 'mock',
      model: 'mock-1',
      startedAt: later(1),
      endedAt: later(4),
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.01,
    };
    const approval: Approval = {
      id: 'appr_1',
      runId: 'run_1',
      threadId: 'thr_1',
      botId: 'bot_1',
      kind: 'send',
      tool: 'gmail.send',
      summary: 'Send the follow-up',
      args: { to: 'ana@example.com' },
      status: 'allowed',
      decision: 'allow_once',
      createdAt: later(2),
      resolvedAt: later(3),
    };
    const otherThreadApproval: Approval = { ...approval, id: 'appr_other', threadId: 'thr_9' };

    const { fetch } = fakeFetch((call) => {
      if (call.path === '/api/threads/thr_1/messages') return json([userMessage, reply]);
      if (call.path === '/api/threads/thr_1/runs') return json([run]);
      if (call.path === '/api/approvals') return json([approval, otherThreadApproval]);
      return json({ error: 'unexpected' }, 500);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const events = await client.history('thr_1');

    expect(events.map((event) => event.type)).toEqual([
      'message.completed',
      'run.started',
      'approval.requested',
      'approval.resolved',
      'message.completed',
      'cost.updated',
      'run.completed',
    ]);
    expect(events.every((event) => event.threadId === 'thr_1')).toBe(true);
    expect(events.find((event) => event.type === 'approval.requested')).toMatchObject({
      approval: { id: 'appr_1', status: 'pending' },
    });
    expect(events.find((event) => event.type === 'cost.updated')).toMatchObject({ runId: 'run_1', costUsd: 0.01 });
  });

  it('reports a cancelled run as run.failed, the way the live path does', async () => {
    const run: Run = {
      id: 'run_2',
      threadId: 'thr_1',
      botId: 'bot_1',
      status: 'cancelled',
      engine: 'mock',
      startedAt: at,
      endedAt: later(1),
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
    const { fetch } = fakeFetch((call) => {
      if (call.path === '/api/threads/thr_1/runs') return json([run]);
      return json([]);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const events = await client.history('thr_1');

    expect(events.at(-1)).toMatchObject({ type: 'run.failed', error: 'Run cancelled.', runId: 'run_2' });
  });

  it('posts a message straight to its thread, with JSON', async () => {
    const { fetch, calls } = fakeFetch(() => json({ runId: 'run_1' }, 202));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.postMessage('thr_1', { content: 'Morning' });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /api/threads/thr_1/messages']);
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toEqual({ content: 'Morning' });
  });

  it('rejects an empty message before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.postMessage('thr_1', { content: '' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('creates a task in the most recent DM thread of its assignee', async () => {
    const task = {
      id: 'task_1',
      title: 'Fix the export',
      status: 'open' as const,
      assigneeBotId: 'bot_2',
      createdByUser: true,
      threadId: 'thr_new',
      chainId: 'task_1',
      depth: 0,
      createdAt: at,
      updatedAt: at,
    };
    const { fetch, calls } = fakeFetch((call) => {
      if (call.path === '/api/bots/bot_2/threads') return json([thread('thr_new', 'bot_2'), thread('thr_old', 'bot_2')]);
      return json(task, 201);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.createTask({ title: 'Fix the export', assigneeBotId: 'bot_2' });

    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      { title: 'Fix the export', assigneeBotId: 'bot_2', threadId: 'thr_new' },
    ]);
  });

  it('creates the assignee first DM thread when a task needs one', async () => {
    const task = {
      id: 'task_1',
      title: 'Fix the export',
      status: 'open' as const,
      assigneeBotId: 'bot_2',
      createdByUser: true,
      threadId: 'thr_created',
      chainId: 'task_1',
      depth: 0,
      createdAt: at,
      updatedAt: at,
    };
    const { fetch, calls } = fakeFetch((call) => {
      if (call.path === '/api/bots/bot_2/threads') return call.method === 'POST' ? json(thread('thr_created', 'bot_2'), 201) : json([]);
      return json(task, 201);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.createTask({ title: 'Fix the export', assigneeBotId: 'bot_2' });

    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      {},
      { title: 'Fix the export', assigneeBotId: 'bot_2', threadId: 'thr_created' },
    ]);
  });
});

describe('resolveApproval', () => {
  it('posts the decision as JSON to the approval route', async () => {
    const approval: Approval = {
      id: 'appr_1',
      runId: 'run_1',
      threadId: 'thr_1',
      botId: 'bot_1',
      kind: 'send',
      tool: 'gmail.send',
      summary: 'Send the follow-up',
      args: {},
      status: 'denied',
      decision: 'deny',
      reply: 'Not today',
      createdAt: at,
      resolvedAt: at,
    };
    const { fetch, calls } = fakeFetch(() => json(approval));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.resolveApproval('appr_1', { decision: 'deny', reply: 'Not today' });

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/approvals/appr_1' });
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(calls[0]?.body).toEqual({ decision: 'deny', reply: 'Not today' });
  });
});

describe('live events', () => {
  it('registers a named listener for every event type on one EventSource', () => {
    const { fetch } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    client.onEvent(() => undefined);

    expect(FakeEventSource.created).toHaveLength(1);
    expect(FakeEventSource.created[0]?.url).toBe('/api/events');
    expect(FakeEventSource.created[0]?.listenerNames()).toEqual(
      expect.arrayContaining(['run.started', 'message.delta', 'message.completed', 'approval.requested', 'run.failed']),
    );
  });

  it('maps a parsed event to its bot through the learned thread list', async () => {
    const { fetch } = fakeFetch((call) => (call.path === '/api/bots/bot_1/threads' ? json([thread('thr_1')]) : json([])));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: BotEvent[] = [];
    client.onEvent((item) => received.push(item));
    await client.listThreads('bot_1');

    const event = messageCompleted('evt_1', 'Done');
    FakeEventSource.created[0]?.send('message.completed', JSON.stringify(event));
    await flush();

    expect(received).toEqual([{ threadId: 'thr_1', botId: 'bot_1', event }]);
  });

  it('looks up a thread it has not seen yet once, for a bot that now has one', async () => {
    let threads: Thread[] = [];
    const { fetch, calls } = fakeFetch((call) => {
      if (call.path === '/api/bots') return json([bot]);
      if (call.path === '/api/bots/bot_1/threads') return json(threads);
      return json([]);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: BotEvent[] = [];
    client.onEvent((item) => received.push(item));
    await client.listBots();
    threads = [thread('thr_2')];

    const event = { ...messageCompleted('evt_2', 'From another device'), threadId: 'thr_2' };
    FakeEventSource.created[0]?.send('message.completed', JSON.stringify(event));
    await flush();

    expect(received).toEqual([{ threadId: 'thr_2', botId: 'bot_1', event }]);
    expect(calls.filter((call) => call.path === '/api/bots/bot_1/threads')).toHaveLength(1);
  });

  it('drops events for threads that belong to no known bot', async () => {
    const { fetch } = fakeFetch((call) => (call.path === '/api/bots/bot_1/threads' ? json([thread('thr_1')]) : json([])));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: BotEvent[] = [];
    client.onEvent((item) => received.push(item));
    await client.listThreads('bot_1');

    const stray = { ...messageCompleted('evt_3', 'Stray'), threadId: 'thr_unknown' };
    FakeEventSource.created[0]?.send('message.completed', JSON.stringify(stray));
    await flush();

    expect(received).toEqual([]);
  });

  it('rejects malformed frames without calling listeners', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch } = fakeFetch((call) => (call.path === '/api/bots/bot_1/threads' ? json([thread('thr_1')]) : json([])));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: BotEvent[] = [];
    client.onEvent((item) => received.push(item));
    await client.listThreads('bot_1');
    const source = FakeEventSource.created[0];

    source?.send('message.completed', '{not json');
    source?.send('message.completed', JSON.stringify({ id: 'evt_4', at, threadId: 'thr_1', type: 'nope' }));
    source?.send('message.completed', JSON.stringify({ ...messageCompleted('evt_5', 'x'), at: 'yesterday' }));
    await flush();

    expect(received).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('delivers events in arrival order when a thread lookup is needed', async () => {
    let threads: Thread[] = [];
    const { fetch } = fakeFetch((call) => {
      if (call.path === '/api/bots') return json([bot]);
      if (call.path === '/api/bots/bot_1/threads') return json(threads);
      return json([]);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: string[] = [];
    client.onEvent(({ event }) => received.push(event.id));
    await client.listBots();
    threads = [thread('thr_2')];

    const source = FakeEventSource.created[0];
    source?.send('message.completed', JSON.stringify({ ...messageCompleted('first', 'a'), threadId: 'thr_2' }));
    source?.send('message.completed', JSON.stringify({ ...messageCompleted('second', 'b'), threadId: 'thr_2' }));
    await flush();

    expect(received).toEqual(['first', 'second']);
  });

  it('closes the stream when the last listener leaves and reopens it for the next one', () => {
    const { fetch } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const stopA = client.onEvent(() => undefined);
    const stopB = client.onEvent(() => undefined);
    expect(FakeEventSource.created).toHaveLength(1);

    stopA();
    expect(FakeEventSource.created[0]?.closed).toBe(false);

    stopB();
    expect(FakeEventSource.created[0]?.closed).toBe(true);

    client.onEvent(() => undefined);
    expect(FakeEventSource.created).toHaveLength(2);
    expect(FakeEventSource.created[1]?.closed).toBe(false);
  });
});

describe('team routes', () => {
  const room: Thread = { ...thread('room_1'), title: 'Acme', kind: 'room', leadBotId: 'bot_1', responder: 'lead' };
  const task: Task = {
    id: 'task_1',
    title: 'Fix the export',
    status: 'open',
    assigneeBotId: 'bot_2',
    createdByUser: true,
    threadId: 'room_1',
    chainId: 'task_1',
    depth: 0,
    createdAt: at,
    updatedAt: at,
  };

  it('lists rooms with their members', async () => {
    const { fetch } = fakeFetch((call) => {
      if (call.path === '/api/rooms') return json([room]);
      if (call.path === '/api/rooms/room_1/members') {
        return json([
          { threadId: 'room_1', botId: 'bot_1', joinedAt: at },
          { threadId: 'room_1', botId: 'bot_2', joinedAt: at },
        ]);
      }
      return json({ error: 'unexpected' }, 500);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.listRooms()).resolves.toEqual([{ thread: room, memberIds: ['bot_1', 'bot_2'] }]);
  });

  it('creates a room with a validated body', async () => {
    const { fetch, calls } = fakeFetch(() => json(room, 201));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const created = await client.createRoom({ title: 'Acme', botIds: ['bot_1', 'bot_2'], leadBotId: 'bot_1', responder: 'mention' });

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/rooms' });
    expect(calls[0]?.body).toEqual({ title: 'Acme', botIds: ['bot_1', 'bot_2'], leadBotId: 'bot_1', responder: 'mention' });
    expect(created.memberIds).toEqual(['bot_1', 'bot_2']);
    await expect(client.createRoom({ title: 'Solo', botIds: ['bot_1'], leadBotId: 'bot_1', responder: 'lead' })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('posts room messages with their mentions', async () => {
    const { fetch, calls } = fakeFetch(() => json({ runId: 'run_1' }, 202));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.postRoomMessage('room_1', { content: '@Onça go', mentions: ['bot_2'] });
    await client.postRoomMessage('room_1', { content: 'anyone', mentions: [] });

    expect(calls.map((call) => call.body)).toEqual([{ content: '@Onça go', mentions: ['bot_2'] }, { content: 'anyone' }]);
    expect(calls[0]?.path).toBe('/api/threads/room_1/messages');
  });

  it('filters tasks through the query string', async () => {
    const { fetch, calls } = fakeFetch(() => json([task]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.listTasks({ assigneeBotId: 'bot_2', status: 'open' })).resolves.toEqual([task]);
    await client.listTasks();

    expect(calls.map((call) => `${call.path}${call.search}`)).toEqual(['/api/tasks?assigneeBotId=bot_2&status=open', '/api/tasks']);
  });

  it('creates a task in a room, or in the assignee\'s DM', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.path === '/api/bots/bot_2/threads') return json([thread('thr_2', 'bot_2')]);
      return json(task, 201);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.createTask({ title: 'Fix the export', assigneeBotId: 'bot_2', roomId: 'room_1' });
    await client.createTask({ title: 'Fix the export', assigneeBotId: 'bot_2' });

    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts.map((call) => call.body)).toEqual([
      { title: 'Fix the export', assigneeBotId: 'bot_2', threadId: 'room_1' },
      { title: 'Fix the export', assigneeBotId: 'bot_2', threadId: 'thr_2' },
    ]);
  });

  it('cancels a task with PATCH', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ...task, status: 'cancelled' }));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.cancelTask('task_1')).resolves.toMatchObject({ status: 'cancelled' });
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/tasks/task_1', body: { status: 'cancelled' } });
  });

  it('routes room events to the room and keeps task events from unknown threads', async () => {
    const { fetch } = fakeFetch((call) => {
      if (call.path === '/api/rooms') return json([room]);
      if (call.path === '/api/rooms/room_1/members') return json([]);
      return json([]);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: BotEvent[] = [];
    client.onEvent((item) => received.push(item));
    await client.listRooms();

    const roomEvent: CanonicalEvent = { id: 'h1', at, threadId: 'room_1', type: 'handoff', fromBotId: 'bot_1', toBotId: 'bot_2' };
    const taskEvent: CanonicalEvent = { id: 't1', at, threadId: 'thr_far', type: 'task.updated', task: { ...task, threadId: 'thr_far' } };
    const stray: CanonicalEvent = { ...messageCompleted('m9', 'Stray'), threadId: 'thr_far' };
    const source = FakeEventSource.created[0];
    source?.send('handoff', JSON.stringify(roomEvent));
    source?.send('task.updated', JSON.stringify(taskEvent));
    source?.send('message.completed', JSON.stringify(stray));
    await flush();
    await flush();

    expect(received).toEqual([
      { threadId: 'room_1', roomId: 'room_1', event: roomEvent },
      { threadId: 'thr_far', event: taskEvent },
    ]);
  });
});
