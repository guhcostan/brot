import { describe, expect, it } from 'vitest';
import { BrotClient } from '../client';
import { runBot } from './run';
import { capture, fakeFetch, json, sse, unreachable } from '../testing';

const at = '2026-10-19T12:00:00.000Z';
const bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};
const older = { id: 't1', botId: 'bot_1', title: 'Old', createdAt: at, updatedAt: '2026-10-18T09:00:00.000Z' };
const newer = { id: 't2', botId: 'bot_1', title: 'Latest', createdAt: at, updatedAt: '2026-10-19T11:00:00.000Z' };

let counter = 0;
function event(type: string, fields: Record<string, unknown> = {}) {
  counter += 1;
  return { id: `e${counter}`, at, threadId: 't2', type, ...fields };
}

const approval = {
  id: 'appr_1',
  runId: 'run_1',
  threadId: 't2',
  botId: 'bot_1',
  kind: 'shell',
  tool: 'shell',
  summary: 'ls -la',
  args: { command: 'ls -la' },
  status: 'pending',
  createdAt: at,
};

function setup(events: Array<{ type: string }>, threads = [older, newer]) {
  return fakeFetch({
    'GET /api/bots/bot_1': () => json(bot),
    'GET /api/bots/bot_1/threads': () => json(threads),
    'POST /api/threads/t2/messages': () => json({ runId: 'run_1' }, 202),
    'GET /api/events': () => sse(events),
  });
}

function deps(fetchImpl: ReturnType<typeof fakeFetch>['fetch']) {
  return {
    client: new BrotClient('http://127.0.0.1:8799', fetchImpl),
    stdout: capture(),
    stderr: capture(),
  };
}

const options = (overrides: { json?: boolean; signal?: AbortSignal } = {}) => ({
  botId: 'bot_1',
  message: 'hello there',
  json: overrides.json ?? false,
  signal: overrides.signal ?? new AbortController().signal,
});

describe('runBot', () => {
  it('prints the assistant reply, ignores other runs, and exits 0 on completion', async () => {
    const { fetch, requests } = setup([
      event('message.completed', { message: { id: 'm0', threadId: 't2', role: 'user', content: 'hello there', createdAt: at } }),
      event('run.started', { runId: 'run_1', botId: 'bot_1', engine: 'mock' }),
      event('run.started', { runId: 'run_0', botId: 'bot_1', engine: 'mock' }),
      event('message.delta', { runId: 'run_1', messageId: 'a', delta: 'You said ' }),
      event('message.delta', { runId: 'run_0', messageId: 'b', delta: 'LEAK' }),
      event('message.delta', { runId: 'run_1', messageId: 'a', delta: 'hi' }),
      event('run.completed', { runId: 'run_1' }),
    ]);
    const io = deps(fetch);

    expect(await runBot(options(), io)).toBe(0);
    expect(io.stdout.text()).toBe('You said hi\n');
    expect(io.stderr.text()).toBe('run run_1 (Capy, mock)\n');
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'GET /api/bots/bot_1',
      'GET /api/bots/bot_1/threads',
      'POST /api/threads/t2/messages',
      expect.stringMatching(/^GET \/api\/events\?threadId=t2&after=/),
    ]);
    expect(requests[2]?.body).toEqual({ content: 'hello there' });
  });

  it('creates a thread when the bot has none', async () => {
    const { fetch, requests } = fakeFetch({
      'GET /api/bots/bot_1': () => json(bot),
      'GET /api/bots/bot_1/threads': () => json([]),
      'POST /api/bots/bot_1/threads': () => json(newer, 201),
      'POST /api/threads/t2/messages': () => json({ runId: 'run_1' }, 202),
      'GET /api/events': () =>
        sse([event('run.started', { runId: 'run_1', botId: 'bot_1', engine: 'mock' }), event('run.completed', { runId: 'run_1' })]),
    });
    const io = deps(fetch);

    expect(await runBot(options(), io)).toBe(0);
    expect(requests.some((request) => request.method === 'POST' && request.path === '/api/bots/bot_1/threads')).toBe(true);
  });

  it('emits every event of the run as one JSON line in json mode', async () => {
    const run = [
      event('run.started', { runId: 'run_1', botId: 'bot_1', engine: 'mock' }),
      event('message.delta', { runId: 'run_1', messageId: 'a', delta: 'ok' }),
      event('run.completed', { runId: 'run_1' }),
    ];
    const io = deps(setup([event('run.started', { runId: 'run_0', botId: 'bot_1', engine: 'mock' }), ...run]).fetch);

    expect(await runBot(options({ json: true }), io)).toBe(0);
    const lines = io.stdout.text().trim().split('\n').map((line) => JSON.parse(line) as { type: string; runId: string });
    expect(lines.map((line) => line.type)).toEqual(['run.started', 'message.delta', 'run.completed']);
    expect(lines.every((line) => line.runId === 'run_1')).toBe(true);
    expect(io.stderr.text()).toBe('');
  });

  it('reports approvals without answering them and keeps waiting for the decision', async () => {
    const { fetch, requests } = setup([
      event('run.started', { runId: 'run_1', botId: 'bot_1', engine: 'mock' }),
      event('approval.requested', { runId: 'run_1', approval }),
      event('approval.resolved', { runId: 'run_1', approval: { ...approval, status: 'allowed', decision: 'allow_once' } }),
      event('run.completed', { runId: 'run_1' }),
    ]);
    const io = deps(fetch);

    expect(await runBot(options(), io)).toBe(0);
    expect(io.stderr.text()).toContain('Approval appr_1 needed (shell, shell): ls -la');
    expect(io.stderr.text()).toContain('curl -X POST http://127.0.0.1:8799/api/approvals/appr_1');
    expect(io.stderr.text()).toContain('Approval appr_1 allowed.');
    expect(requests.some((request) => request.path.startsWith('/api/approvals'))).toBe(false);
  });

  it('exits 1 with the error when the run fails', async () => {
    const io = deps(setup([event('run.started', { runId: 'run_1', botId: 'bot_1', engine: 'mock' }), event('run.failed', { runId: 'run_1', error: 'boom' })]).fetch);

    expect(await runBot(options(), io)).toBe(1);
    expect(io.stderr.text()).toContain('Run failed: boom');
  });

  it('exits 1 when the stream ends before the run settles', async () => {
    const io = deps(setup([event('run.started', { runId: 'run_1', botId: 'bot_1', engine: 'mock' })]).fetch);

    expect(await runBot(options(), io)).toBe(1);
    expect(io.stderr.text()).toContain('The event stream closed before the run finished.');
  });

  it('fails clearly for an unknown bot', async () => {
    const { fetch } = fakeFetch({ 'GET /api/bots/bot_1': () => json({ error: 'Bot not found' }, 404) });
    const io = deps(fetch);

    expect(await runBot(options(), io)).toBe(1);
    expect(io.stderr.text()).toBe('No bot with id bot_1 on http://127.0.0.1:8799.\n');
  });

  it('stops watching mid-stream on interrupt, exits 130, and names the run to cancel', async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch({
      'GET /api/bots/bot_1': () => json(bot),
      'GET /api/bots/bot_1/threads': () => json([newer]),
      'POST /api/threads/t2/messages': () => json({ runId: 'run_1' }, 202),
      'GET /api/events': (_request, signal) => {
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            const first = event('message.delta', { runId: 'run_1', messageId: 'a', delta: 'partial' });
            streamController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(first)}\n\n`));
            signal?.addEventListener('abort', () => streamController.error(new DOMException('aborted', 'AbortError')));
            setTimeout(() => controller.abort(), 0);
          },
        });
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
      },
    });
    const io = deps(fetch);

    expect(await runBot(options({ signal: controller.signal }), io)).toBe(130);
    expect(io.stdout.text()).toBe('partial\n');
    expect(io.stderr.text()).toContain('Stopped watching run run_1.');
    expect(io.stderr.text()).toContain('POST http://127.0.0.1:8799/api/runs/run_1/cancel');
  });

  it('propagates connection failures', async () => {
    const io = { client: new BrotClient('http://127.0.0.1:8799', unreachable), stdout: capture(), stderr: capture() };

    await expect(runBot(options(), io)).rejects.toThrow('No Brot server answered at http://127.0.0.1:8799');
  });
});
