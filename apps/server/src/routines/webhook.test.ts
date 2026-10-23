import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminActivity, Bot, Routine, RoutineRun } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createBot(): Promise<Bot> {
  const response = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Ops' });
  expect(response.status).toBe(201);
  return json<Bot>(response);
}

async function createRoutine(trigger: Routine['trigger']): Promise<Routine> {
  const bot = await createBot();
  const response = await call(ctx.app, 'POST', '/api/routines', {
    botId: bot.id,
    name: 'Inbox triage',
    instruction: 'Triage the inbox.',
    trigger,
  });
  expect(response.status).toBe(201);
  return json<Routine>(response);
}

async function createWebhookRoutine(): Promise<Routine> {
  return createRoutine({ type: 'webhook', secret: '' });
}

function secretOf(routine: Routine): string {
  if (routine.trigger.type !== 'webhook') throw new Error('expected a webhook routine');
  return routine.trigger.secret;
}

function rotate(id: string): Promise<Response> {
  return call(ctx.app, 'POST', `/api/routines/${id}/webhook/rotate`);
}

function postWebhook(secret: string): Promise<Response> {
  return Promise.resolve(
    ctx.webhooks.request(`/h/${secret}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'Invoice' }),
    }),
  );
}

async function waitForCompletedRun(routineId: string): Promise<RoutineRun[]> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const runs = await json<RoutineRun[]>(
      await call(ctx.app, 'GET', `/api/routine-runs?routineId=${routineId}`),
    );
    if (runs.some((run) => run.status === 'completed')) return runs;
    if (Date.now() > deadline) throw new Error('timed out waiting for the routine run');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('GET /api/webhooks', () => {
  it('reports the receiver port and nothing secret', async () => {
    const response = await call(ctx.app, 'GET', '/api/webhooks');
    expect(response.status).toBe(200);
    const body = await json<{ port: number }>(response);
    expect(body.port).toBe(ctx.services.config.webhookPort);
    expect(typeof body.port).toBe('number');
    expect(Object.keys(body)).toEqual(['port']);
    expect(JSON.stringify(body)).not.toMatch(/secret|vault/i);
  });
});

describe('POST /api/routines/:id/webhook/rotate', () => {
  it('returns a routine with a new persistent secret and kills the old URL immediately', async () => {
    const routine = await createWebhookRoutine();
    const oldSecret = secretOf(routine);
    expect(oldSecret.length).toBeGreaterThan(20);

    const response = await rotate(routine.id);
    expect(response.status).toBe(200);
    const rotated = await json<Routine>(response);
    const newSecret = secretOf(rotated);
    expect(newSecret).not.toBe(oldSecret);
    expect(newSecret.length).toBeGreaterThanOrEqual(32);
    expect(newSecret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(rotated.id).toBe(routine.id);
    // The response carries the new secret (the thing a person copies) and not the old one.
    expect(JSON.stringify(rotated)).not.toContain(oldSecret);

    // Persisted: the routine list shows the new secret, not the old one.
    const routines = await json<Routine[]>(await call(ctx.app, 'GET', '/api/routines'));
    const stored = routines.find((entry) => entry.id === routine.id);
    expect(stored === undefined ? undefined : secretOf(stored)).toBe(newSecret);

    // The old URL is gone the moment the rotation returns; the new one runs the routine.
    expect((await postWebhook(oldSecret)).status).toBe(404);
    expect((await postWebhook(newSecret)).status).toBe(202);
    const runs = await waitForCompletedRun(routine.id);
    expect(runs[0]).toMatchObject({ trigger: 'webhook', status: 'completed' });
  });

  it('records an admin activity entry', async () => {
    const routine = await createWebhookRoutine();
    expect((await rotate(routine.id)).status).toBe(200);

    const entries = await json<AdminActivity[]>(await call(ctx.app, 'GET', '/api/activity'));
    expect(entries[0]).toMatchObject({
      action: 'updated',
      targetType: 'routine',
      targetId: routine.id,
      summary: 'Rotated webhook secret for routine "Inbox triage"',
      actor: 'local',
    });
  });

  it('answers 409 for a cron routine and leaves its trigger alone', async () => {
    const routine = await createRoutine({ type: 'cron', cron: '0 9 * * *' });
    const response = await rotate(routine.id);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/webhook/i);

    const routines = await json<Routine[]>(await call(ctx.app, 'GET', '/api/routines'));
    expect(routines.find((entry) => entry.id === routine.id)?.trigger).toEqual({ type: 'cron', cron: '0 9 * * *' });
  });

  it('answers 404 for an unknown routine', async () => {
    const response = await rotate('missing-routine');
    expect(response.status).toBe(404);
  });

  it('generates a different secret on every rotation', async () => {
    const routine = await createWebhookRoutine();
    const first = secretOf(await json<Routine>(await rotate(routine.id)));
    const second = secretOf(await json<Routine>(await rotate(routine.id)));
    expect(second).not.toBe(first);
    expect((await postWebhook(first)).status).toBe(404);
    expect((await postWebhook(second)).status).toBe(202);
  });

  it('keeps the create behavior: an empty webhook secret is filled in', async () => {
    const routine = await createWebhookRoutine();
    expect(secretOf(routine).length).toBeGreaterThan(20);
  });
});
