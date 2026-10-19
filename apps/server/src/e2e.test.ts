import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineRegistry, createMockEngine } from '@brot/engines';
import {
  Approval,
  Bot,
  Message,
  parseEvent,
  Run,
  Thread,
  type ApprovalDecision,
  type CanonicalEvent,
  type CanonicalEventType,
} from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startServer } from './index';

const WAIT_MS = 5000;

/** Events every run emits when the mock engine asks for one shell approval, whatever the decision. */
const TOOL_RUN_SEQUENCE: CanonicalEventType[] = [
  'run.started',
  'approval.requested',
  'approval.resolved',
  'tool.call',
  'tool.result',
  'cost.updated',
  'message.completed',
  'run.completed',
];

class Session {
  readonly events: CanonicalEvent[] = [];
  private failure: unknown;
  private readonly streamAbort = new AbortController();

  private constructor(readonly base: string) {}

  /** Boots the real server on an ephemeral port and a temporary BROT_HOME, then opens the SSE stream. */
  static async open(): Promise<{ session: Session; close: () => Promise<void> }> {
    const home = await mkdtemp(join(tmpdir(), 'brot-e2e-'));
    const server = await startServer({
      home,
      host: '127.0.0.1',
      port: 0,
      webhookPort: 0,
      engines: createEngineRegistry([createMockEngine()]),
    });
    const session = new Session(`http://127.0.0.1:${server.port}`);
    const close = async (): Promise<void> => {
      session.streamAbort.abort();
      await server.close();
      await rm(home, { recursive: true, force: true });
    };
    try {
      await session.connectEvents();
    } catch (error) {
      await close();
      throw error;
    }
    return { session, close };
  }

  /** The subscription is registered before the response headers are sent, so every later event is captured. */
  private async connectEvents(): Promise<void> {
    const response = await fetch(`${this.base}/api/events`, { signal: this.streamAbort.signal });
    if (!response.ok || !response.body) throw new Error(`event stream responded with ${response.status}`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    readEvents(response.body, (data) => this.events.push(parseEvent(JSON.parse(data)))).catch((error: unknown) => {
      if (!this.streamAbort.signal.aborted) this.failure = error;
    });
  }

  call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async createThread(): Promise<{ bot: Bot; thread: Thread }> {
    const bot = await expectStatus(
      await this.call('POST', '/api/bots', { name: 'Ada', job: 'Ops', engine: 'mock', computer: 'none' }),
      201,
      (value) => Bot.parse(value),
    );
    const thread = await expectStatus(
      await this.call('POST', `/api/bots/${bot.id}/threads`, { title: 'Shell' }),
      201,
      (value) => Thread.parse(value),
    );
    return { bot, thread };
  }

  async postMessage(threadId: string, content: string): Promise<string> {
    const { runId } = await expectStatus(
      await this.call('POST', `/api/threads/${threadId}/messages`, { content }),
      202,
      (value) => z.object({ runId: z.string() }).parse(value),
    );
    return runId;
  }

  async decide(approvalId: string, decision: ApprovalDecision, reply?: string): Promise<Approval> {
    return expectStatus(
      await this.call('POST', `/api/approvals/${approvalId}`, reply === undefined ? { decision } : { decision, reply }),
      200,
      (value) => Approval.parse(value),
    );
  }

  /** Waits for the next event of this type on the run, failing fast if the stream reported an invalid event. */
  async nextEvent<T extends CanonicalEventType>(type: T, runId: string): Promise<Extract<CanonicalEvent, { type: T }>> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      if (this.failure) throw this.failure;
      const found = this.events.find((event) => event.type === type && event.runId === runId);
      if (found) return found as Extract<CanonicalEvent, { type: T }>;
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${type} on ${runId}; saw: ${this.typesFor(runId).join(', ')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  typesFor(runId: string): CanonicalEventType[] {
    return this.events.filter((event) => event.runId === runId).map((event) => event.type);
  }

  eventsFor(runId: string): CanonicalEvent[] {
    return this.events.filter((event) => event.runId === runId);
  }
}

async function readEvents(body: ReadableStream<Uint8Array>, onData: (data: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');
      if (data !== '') onData(data);
    }
  }
}

async function expectStatus<T>(response: Response, status: number, parse: (value: unknown) => T): Promise<T> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return parse(body);
}

describe('end-to-end over HTTP and SSE with the mock engine', () => {
  it('runs a shell tool call through approval to completion', async () => {
    const { session, close } = await Session.open();
    try {
      const { bot, thread } = await session.createThread();
      expect(bot).toMatchObject({ name: 'Ada', engine: 'mock' });
      const runId = await session.postMessage(thread.id, '/tool shell echo hello');

      const requested = Approval.parse((await session.nextEvent('approval.requested', runId)).approval);
      expect(requested).toMatchObject({
        runId,
        threadId: thread.id,
        botId: bot.id,
        kind: 'shell',
        tool: 'shell',
        summary: 'echo hello',
        args: { command: 'echo hello' },
        status: 'pending',
      });
      expect(
        await expectStatus(await session.call('GET', '/api/approvals?status=pending'), 200, (value) =>
          Approval.array().parse(value),
        ),
      ).toEqual([requested]);

      const resolved = await session.decide(requested.id, 'allow_once');
      expect(resolved).toMatchObject({ status: 'allowed', decision: 'allow_once' });

      await session.nextEvent('run.completed', runId);
      expect(session.typesFor(runId)).toEqual(TOOL_RUN_SEQUENCE);
      expect(session.eventsFor(runId).every((event) => event.threadId === thread.id)).toBe(true);

      const approvalResolved = await session.nextEvent('approval.resolved', runId);
      expect(Approval.parse(approvalResolved.approval)).toMatchObject({ id: requested.id, status: 'allowed' });
      expect(await session.nextEvent('tool.result', runId)).toMatchObject({ ok: true, output: 'ok' });

      const messages = await expectStatus(await session.call('GET', `/api/threads/${thread.id}/messages`), 200, (value) =>
        Message.array().parse(value),
      );
      expect(messages.map((message) => [message.role, message.content])).toEqual([
        ['user', '/tool shell echo hello'],
        ['assistant', ''],
      ]);

      const runs = await expectStatus(await session.call('GET', `/api/threads/${thread.id}/runs`), 200, (value) =>
        Run.array().parse(value),
      );
      expect(runs).toEqual([expect.objectContaining({ id: runId, status: 'completed' })]);
    } finally {
      await close();
    }
  }, 15_000);

  it('reports a denied tool call with the user reply and still completes the run', async () => {
    const { session, close } = await Session.open();
    try {
      const { thread } = await session.createThread();
      const runId = await session.postMessage(thread.id, '/tool shell rm -rf build');

      const requested = Approval.parse((await session.nextEvent('approval.requested', runId)).approval);
      const resolved = await session.decide(requested.id, 'deny', 'use trash instead');
      expect(resolved).toMatchObject({ status: 'denied', decision: 'deny', reply: 'use trash instead' });

      await session.nextEvent('run.completed', runId);
      expect(session.typesFor(runId)).toEqual(TOOL_RUN_SEQUENCE);
      expect(session.events.some((event) => event.type === 'message.delta')).toBe(false);

      const approvalResolved = await session.nextEvent('approval.resolved', runId);
      expect(Approval.parse(approvalResolved.approval)).toMatchObject({ status: 'denied', decision: 'deny' });
      expect(await session.nextEvent('tool.result', runId)).toMatchObject({
        ok: false,
        output: 'denied by user: use trash instead',
      });

      const runs = await expectStatus(await session.call('GET', `/api/threads/${thread.id}/runs`), 200, (value) =>
        Run.array().parse(value),
      );
      expect(runs).toEqual([expect.objectContaining({ id: runId, status: 'completed' })]);
      expect(
        await expectStatus(await session.call('GET', '/api/approvals?status=pending'), 200, (value) =>
          Approval.array().parse(value),
        ),
      ).toEqual([]);
    } finally {
      await close();
    }
  }, 15_000);
});
