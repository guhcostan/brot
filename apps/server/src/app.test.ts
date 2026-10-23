import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineRegistry, createMockEngine } from '@brot/engines';
import type { Bot, Memory, Message, Run, Thread } from '@brot/protocol';
import type { ComputerProvider } from './computers';
import { call, createTestContext, recordEvents, waitUntil, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function createBot(overrides: Record<string, unknown> = {}): Promise<Bot> {
  const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as Bot;
}

async function createThread(botId: string): Promise<Thread> {
  const res = await call(ctx.app, 'POST', `/api/bots/${botId}/threads`, { title: 'Chat' });
  expect(res.status).toBe(201);
  return (await res.json()) as Thread;
}

describe('health and engines', () => {
  it('reports the server version and protocol', async () => {
    const res = await call(ctx.app, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: '0.1.0', protocol: 1 });
  });

  it('lists engines with availability and models', async () => {
    const res = await call(ctx.app, 'GET', '/api/engines');
    expect(await res.json()).toEqual([
      { id: 'mock', label: 'Mock', availability: { available: true }, models: [{ id: 'mock-1', label: 'Mock' }] },
    ]);
  });
});

describe('bots', () => {
  it('creates, reads, updates and deletes a bot', async () => {
    const bot = await createBot({ instructions: 'Be brief.' });
    expect(bot).toMatchObject({ name: 'Ada', engine: 'mock', computer: 'sandbox', pinned: false, archived: false });

    const listed = (await (await call(ctx.app, 'GET', '/api/bots')).json()) as Bot[];
    expect(listed.map((b) => b.id)).toEqual([bot.id]);

    const patched = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { job: 'Analyst', pinned: true });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ job: 'Analyst', pinned: true });

    const removed = await call(ctx.app, 'DELETE', `/api/bots/${bot.id}`);
    expect(removed.status).toBe(204);
    expect((await call(ctx.app, 'GET', `/api/bots/${bot.id}`)).status).toBe(404);
  });

  it('rejects invalid bodies with 400 and the zod issues', async () => {
    const res = await call(ctx.app, 'POST', '/api/bots', { name: '', job: 'Researcher' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { path: unknown[] }[] };
    expect(body.error).toBe('Invalid request');
    expect(body.issues.some((issue) => issue.path.includes('name'))).toBe(true);

    const notJson = await ctx.app.request('/api/bots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(notJson.status).toBe(400);
    expect((await notJson.json()) as { error: string }).toMatchObject({ error: 'Request body must be valid JSON' });
  });

  it('returns 404 for missing bots', async () => {
    expect((await call(ctx.app, 'GET', '/api/bots/nope')).status).toBe(404);
    expect((await call(ctx.app, 'PATCH', '/api/bots/nope', { job: 'x' })).status).toBe(404);
    expect((await call(ctx.app, 'DELETE', '/api/bots/nope')).status).toBe(404);
  });
});

describe('bot computers on delete and convert', () => {
  /** A provider that records the ids it is asked to stop; `fail` makes stop throw after recording. */
  function recordingProvider(id: 'docker' | 'host', stops: string[], fail = false): ComputerProvider {
    return {
      id,
      available: async () => ({ ok: true }),
      ensure: async () => {
        throw new Error('the fake provider never starts a computer');
      },
      internalEndpoint: () => ({ url: 'http://127.0.0.1:8799' }),
      stop: async (botId) => {
        stops.push(botId);
        if (fail) throw new Error(`${id} stop failed`);
      },
      close: async () => undefined,
    };
  }

  it('stops every computer provider once with the bot id before deleting the bot', async () => {
    const stops: string[] = [];
    const local = await createTestContext({
      computers: { sandbox: recordingProvider('docker', stops), host: recordingProvider('host', stops) },
    });
    try {
      const created = await call(local.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher' });
      expect(created.status).toBe(201);
      const bot = (await created.json()) as Bot;

      expect((await call(local.app, 'DELETE', `/api/bots/${bot.id}`)).status).toBe(204);
      expect(stops).toEqual([bot.id, bot.id]);
      expect(await local.services.repos.bots.get(bot.id)).toBeUndefined();
    } finally {
      await local.close();
    }
  });

  it('returns 204 and logs when a provider stop throws', async () => {
    const stops: string[] = [];
    const local = await createTestContext({ computers: { sandbox: recordingProvider('docker', stops, true) } });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const bot = (await (
        await call(local.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher' })
      ).json()) as Bot;

      expect((await call(local.app, 'DELETE', `/api/bots/${bot.id}`)).status).toBe(204);
      expect(stops).toEqual([bot.id]);
      expect(logged.mock.calls.some((args) => String(args[0]).includes('could not stop the docker computer'))).toBe(
        true,
      );
      expect(await local.services.repos.bots.get(bot.id)).toBeUndefined();
    } finally {
      logged.mockRestore();
      await local.close();
    }
  });

  it('stops the sandbox computer when a bot stops being a sandbox bot', async () => {
    const stops: string[] = [];
    const local = await createTestContext({ computers: { sandbox: recordingProvider('docker', stops) } });
    try {
      const bot = (await (
        await call(local.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher' })
      ).json()) as Bot;

      const patched = await call(local.app, 'PATCH', `/api/bots/${bot.id}`, { computer: 'none' });
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({ computer: 'none' });
      expect(stops).toEqual([bot.id]);

      // Editing other fields and switching back to sandbox stops nothing: only leaving sandbox does.
      await call(local.app, 'PATCH', `/api/bots/${bot.id}`, { name: 'Grace' });
      expect((await call(local.app, 'PATCH', `/api/bots/${bot.id}`, { computer: 'sandbox' })).status).toBe(200);
      expect(stops).toEqual([bot.id]);
    } finally {
      await local.close();
    }
  });

  it('still updates the bot when stopping the old sandbox throws', async () => {
    const stops: string[] = [];
    const local = await createTestContext({ computers: { sandbox: recordingProvider('docker', stops, true) } });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const bot = (await (
        await call(local.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher' })
      ).json()) as Bot;

      const patched = await call(local.app, 'PATCH', `/api/bots/${bot.id}`, { computer: 'none' });
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({ id: bot.id, computer: 'none' });
      expect(stops).toEqual([bot.id]);
      expect(logged.mock.calls.some((args) => String(args[0]).includes('could not stop the docker computer'))).toBe(
        true,
      );
    } finally {
      logged.mockRestore();
      await local.close();
    }
  });
});

describe('messages and runs', () => {
  it('streams a reply from the mock engine and stores the assistant message', async () => {
    const bot = await createBot();
    const thread = await createThread(bot.id);
    const events = recordEvents(ctx.services.bus, thread.id);

    const res = await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'hello there' });
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };

    await waitUntil(() => events.list.find((event) => event.type === 'run.completed'));
    const types = events.list.map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(['run.started', 'message.delta', 'message.completed', 'cost.updated', 'run.completed']));
    expect(types.indexOf('run.started')).toBeLessThan(types.indexOf('message.delta'));

    const deltas = events.list.flatMap((event) => (event.type === 'message.delta' ? [event] : []));
    const messageId = deltas[0]?.type === 'message.delta' ? deltas[0].messageId : undefined;
    const streamed = deltas.map((event) => (event.type === 'message.delta' ? event.delta : '')).join('');
    expect(streamed).toBe('You said: hello there');

    const messages = (await (await call(ctx.app, 'GET', `/api/threads/${thread.id}/messages`)).json()) as Message[];
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]).toMatchObject({ id: messageId, content: streamed });

    const runs = (await (await call(ctx.app, 'GET', `/api/threads/${thread.id}/runs`)).json()) as Run[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: runId, status: 'completed', engine: 'mock' });
    expect(runs[0]?.tokensIn).toBeGreaterThan(0);
    events.stop();
  });

  it('fails the run with a clear message when the engine is not registered', async () => {
    const bot = await createBot({ engine: 'nowhere' });
    const thread = await createThread(bot.id);
    const events = recordEvents(ctx.services.bus, thread.id);

    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'hi' });
    const failed = await waitUntil(() => events.list.find((event) => event.type === 'run.failed'));
    expect(failed.type === 'run.failed' && failed.error).toContain('Engine "nowhere" is not registered');
    events.stop();
  });

  it('/remember stores a fact memory and announces it', async () => {
    const bot = await createBot();
    const thread = await createThread(bot.id);
    const events = recordEvents(ctx.services.bus, thread.id);

    const res = await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: '/remember Ada prefers tea' });
    const { runId } = (await res.json()) as { runId: string };
    await waitUntil(() => events.list.find((event) => event.type === 'run.completed'));

    const memories = (await (await call(ctx.app, 'GET', `/api/bots/${bot.id}/memories`)).json()) as Memory[];
    expect(memories).toEqual([
      expect.objectContaining({ kind: 'fact', content: 'Ada prefers tea', sourceRunId: runId }),
    ]);
    expect(events.list.some((event) => event.type === 'memory.written')).toBe(true);
    events.stop();
  });

  it('cancels a running reply', async () => {
    await ctx.close();
    ctx = await createTestContext({ engines: createEngineRegistry([createMockEngine({ delayMs: 100 })]) });
    const bot = await createBot();
    const thread = await createThread(bot.id);
    const events = recordEvents(ctx.services.bus, thread.id);

    const res = await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'one two three four five six' });
    const { runId } = (await res.json()) as { runId: string };
    await waitUntil(() => events.list.find((event) => event.type === 'message.delta'));

    const cancelled = await call(ctx.app, 'POST', `/api/runs/${runId}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ id: runId, status: 'cancelled' });
    expect(events.list.some((event) => event.type === 'message.completed' && event.message.role === 'assistant')).toBe(false);
    expect((await call(ctx.app, 'POST', '/api/runs/missing/cancel')).status).toBe(404);
    events.stop();
  });
});
