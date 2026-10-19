import type { Approval, Bot, CanonicalEvent, Message, Run, Thread } from '@brot/protocol';
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
  headers: Headers;
  body: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Records every request and answers with whatever `respond` returns for it. */
function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: input,
      path: new URL(input, 'http://brot.test').pathname,
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
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

describe('history', () => {
  it('returns no events and creates no thread when the bot has none', async () => {
    const { fetch, calls } = fakeFetch(() => json([]));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.history('bot_1')).resolves.toEqual([]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /api/bots/bot_1/threads']);
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
      if (call.path === '/api/bots/bot_1/threads') return json([thread('thr_1')]);
      if (call.path === '/api/threads/thr_1/messages') return json([userMessage, reply]);
      if (call.path === '/api/threads/thr_1/runs') return json([run]);
      if (call.path === '/api/approvals') return json([approval, otherThreadApproval]);
      return json({ error: 'unexpected' }, 500);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const events = await client.history('bot_1');

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
      if (call.path === '/api/bots/bot_1/threads') return json([thread('thr_1')]);
      if (call.path === '/api/threads/thr_1/runs') return json([run]);
      return json([]);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    const events = await client.history('bot_1');

    expect(events.at(-1)).toMatchObject({ type: 'run.failed', error: 'Run cancelled.', runId: 'run_2' });
  });
});

describe('thread creation and caching', () => {
  it('creates the first thread on first post, then posts the message with JSON', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET') return json([]);
      if (call.method === 'POST' && call.path === '/api/bots/bot_1/threads') return json(thread('thr_1'), 201);
      return json({ runId: 'run_1' }, 202);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.postMessage('bot_1', { content: 'Morning' });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/bots/bot_1/threads',
      'POST /api/bots/bot_1/threads',
      'POST /api/threads/thr_1/messages',
    ]);
    const message = calls[2];
    expect(message?.headers.get('Content-Type')).toBe('application/json');
    expect(message?.body).toEqual({ content: 'Morning' });
  });

  it('reuses the cached thread for later posts and history', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET' && call.path === '/api/bots/bot_1/threads') return json([thread('thr_1')]);
      if (call.path === '/api/threads/thr_1/runs') return json([]);
      if (call.path === '/api/threads/thr_1/messages') return json([]);
      if (call.path === '/api/approvals') return json([]);
      return json({ runId: 'run_1' }, 202);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.postMessage('bot_1', { content: 'One' });
    await client.postMessage('bot_1', { content: 'Two' });
    await client.history('bot_1');

    expect(calls.filter((call) => call.path === '/api/bots/bot_1/threads')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/threads/thr_1/messages')).toHaveLength(
      2,
    );
  });

  it('uses the first thread the server lists', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET') return json([thread('thr_2'), thread('thr_1')]);
      return json({ runId: 'run_1' }, 202);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await client.postMessage('bot_1', { content: 'Hi' });

    expect(calls.at(-1)?.path).toBe('/api/threads/thr_2/messages');
  });

  it('creates a single thread when posts race', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === 'GET') return json([]);
      if (call.method === 'POST' && call.path === '/api/bots/bot_1/threads') return json(thread('thr_1'), 201);
      return json({ runId: 'run_1' }, 202);
    });
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await Promise.all([
      client.postMessage('bot_1', { content: 'A' }),
      client.postMessage('bot_1', { content: 'B' }),
    ]);

    expect(calls.filter((call) => call.method === 'POST' && call.path === '/api/bots/bot_1/threads')).toHaveLength(1);
    expect(calls.filter((call) => call.path === '/api/threads/thr_1/messages')).toHaveLength(2);
  });

  it('rejects an empty message before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });

    await expect(client.postMessage('bot_1', { content: '' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
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

  it('maps a parsed event to its bot through the cached thread', async () => {
    const { fetch } = fakeFetch((call) => (call.path === '/api/bots/bot_1/threads' ? json([thread('thr_1')]) : json([])));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: BotEvent[] = [];
    client.onEvent((item) => received.push(item));
    await client.history('bot_1');

    const event = messageCompleted('evt_1', 'Done');
    FakeEventSource.created[0]?.send('message.completed', JSON.stringify(event));
    await flush();

    expect(received).toEqual([{ botId: 'bot_1', event }]);
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

    expect(received).toEqual([{ botId: 'bot_1', event }]);
    expect(calls.filter((call) => call.path === '/api/bots/bot_1/threads')).toHaveLength(1);
  });

  it('drops events for threads that belong to no known bot', async () => {
    const { fetch } = fakeFetch((call) => (call.path === '/api/bots/bot_1/threads' ? json([thread('thr_1')]) : json([])));
    const client = createHttpClient({ fetch, EventSource: FakeEventSource });
    const received: BotEvent[] = [];
    client.onEvent((item) => received.push(item));
    await client.history('bot_1');

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
    await client.history('bot_1');
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
