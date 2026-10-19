import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Routine, Thread } from '@brot/protocol';
import { call, createTestContext, recordEvents, waitUntil, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function createWebhookRoutine(enabled = true): Promise<{ bot: Bot; routine: Routine; secret: string }> {
  const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Ops' })).json()) as Bot;
  const res = await call(ctx.app, 'POST', '/api/routines', {
    botId: bot.id,
    name: 'Inbox triage',
    instruction: 'Triage the inbox.',
    trigger: { type: 'webhook', secret: '' },
    enabled,
  });
  expect(res.status).toBe(201);
  const routine = (await res.json()) as Routine;
  expect(routine.trigger.type === 'webhook' && routine.trigger.secret.length).toBeGreaterThan(20);
  return { bot, routine, secret: routine.trigger.type === 'webhook' ? routine.trigger.secret : '' };
}

function post(path: string, body: string): Promise<Response> {
  return Promise.resolve(
    ctx.webhooks.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
  );
}

describe('webhook receiver', () => {
  it('runs the routine with the posted payload and answers 202', async () => {
    const { bot, secret } = await createWebhookRoutine();
    const events = recordEvents(ctx.services.bus);

    const res = await post(`/h/${secret}`, JSON.stringify({ subject: 'Invoice' }));
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };

    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === runId));
    const threads = (await (await call(ctx.app, 'GET', `/api/bots/${bot.id}/threads`)).json()) as Thread[];
    const thread = threads.find((item) => item.title === 'Inbox triage');
    expect(thread).toBeDefined();

    const messages = (await (await call(ctx.app, 'GET', `/api/threads/${thread?.id}/messages`)).json()) as {
      role: string;
      content: string;
    }[];
    expect(messages[0]).toMatchObject({ role: 'user' });
    expect(messages[0]?.content).toContain('Triage the inbox.');
    expect(messages[0]?.content).toContain('{"subject":"Invoice"}');
    events.stop();
  });

  it('answers 404 for unknown secrets, disabled routines and any other path', async () => {
    const { secret } = await createWebhookRoutine(false);
    expect((await post(`/h/${secret}`, '{}')).status).toBe(404);
    expect((await post('/h/not-a-secret', '{}')).status).toBe(404);
    expect((await ctx.webhooks.request('/api/bots')).status).toBe(404);
    expect((await ctx.webhooks.request(`/h/${secret}`, { method: 'GET' })).status).toBe(404);
  });

  it('rejects oversized payloads', async () => {
    const { secret } = await createWebhookRoutine();
    const huge = JSON.stringify({ blob: 'x'.repeat(300 * 1024) });
    expect((await post(`/h/${secret}`, huge)).status).toBe(413);
  });
});
