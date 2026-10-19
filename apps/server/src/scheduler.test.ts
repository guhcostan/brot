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

describe('routines', () => {
  it('rejects an invalid cron pattern with an issue on trigger.cron', async () => {
    const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x' })).json()) as Bot;
    const res = await call(ctx.app, 'POST', '/api/routines', {
      botId: bot.id,
      name: 'Broken',
      instruction: 'x',
      trigger: { type: 'cron', cron: 'every tuesday' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: { path: string[] }[] };
    expect(body.issues[0]?.path).toEqual(['trigger', 'cron']);
  });

  it('schedules a cron routine, runs it in a thread named after it, and reuses that thread', async () => {
    const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x' })).json()) as Bot;
    const created = await call(ctx.app, 'POST', '/api/routines', {
      botId: bot.id,
      name: 'Daily digest',
      instruction: 'Summarise the day.',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    expect(created.status).toBe(201);
    const routine = (await created.json()) as Routine;
    expect(routine.nextRunAt).toBeDefined();
    expect(routine.lastRunAt).toBeUndefined();

    const events = recordEvents(ctx.services.bus);
    const first = (await (await call(ctx.app, 'POST', `/api/routines/${routine.id}/run`)).json()) as { runId: string };
    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === first.runId));

    const afterRun = (await (await call(ctx.app, 'GET', `/api/routines`)).json()) as Routine[];
    expect(afterRun[0]?.lastRunAt).toBeDefined();

    await call(ctx.app, 'POST', `/api/routines/${routine.id}/run`);
    const threads = (await (await call(ctx.app, 'GET', `/api/bots/${bot.id}/threads`)).json()) as Thread[];
    expect(threads.filter((thread) => thread.title === 'Daily digest')).toHaveLength(1);
    events.stop();
  });

  it('updates the schedule, disables a routine, and deletes it', async () => {
    const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x' })).json()) as Bot;
    const routine = (await (
      await call(ctx.app, 'POST', '/api/routines', {
        botId: bot.id,
        name: 'Weekly',
        instruction: 'x',
        trigger: { type: 'cron', cron: '0 9 * * 1' },
      })
    ).json()) as Routine;

    const patched = await call(ctx.app, 'PATCH', `/api/routines/${routine.id}`, { enabled: false });
    expect(await patched.json()).toMatchObject({ enabled: false });
    expect((await call(ctx.app, 'DELETE', `/api/routines/${routine.id}`)).status).toBe(204);
    expect((await call(ctx.app, 'POST', `/api/routines/${routine.id}/run`)).status).toBe(404);
  });
});
