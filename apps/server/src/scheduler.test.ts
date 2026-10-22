import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Cron } from 'croner';
import type { Bot, Routine, RoutineRun } from '@brot/protocol';
import { createApp } from './app';
import type { Harness } from './harness';
import { CATCH_UP_WINDOW_MS, createScheduler, missedOccurrence, type Scheduler } from './scheduler';
import { call, createTestContext, recordEvents, waitUntil, type TestContext } from './testing';

let ctx: TestContext;
const schedulers: Scheduler[] = [];

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) scheduler.stop();
  await ctx.close();
});

async function createBot(overrides: Record<string, unknown> = {}): Promise<Bot> {
  const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as Bot;
}

async function createRoutine(botId: string, body: Record<string, unknown> = {}): Promise<Routine> {
  const res = await call(ctx.app, 'POST', '/api/routines', {
    botId,
    name: 'Daily digest',
    instruction: 'Summarise the day.',
    trigger: { type: 'cron', cron: '0 9 * * *' },
    ...body,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Routine;
}

/** A harness whose runs are started but never finish, so the test decides how each run ends. */
function fakeHarness(options: { failStart?: Error } = {}): {
  inputs: { threadId: string; input: string }[];
  harness: Harness;
} {
  const inputs: { threadId: string; input: string }[] = [];
  const unused = (): Promise<never> => Promise.reject(new Error('the fake harness does not support this call'));
  return {
    inputs,
    harness: {
      async startRun(threadId, input) {
        if (options.failStart !== undefined) throw options.failStart;
        inputs.push({ threadId, input });
        const thread = await ctx.services.repos.threads.get(threadId);
        if (thread === undefined) throw new Error(`thread ${threadId} does not exist`);
        const run = await ctx.services.repos.runs.create({ threadId, botId: thread.botId, engine: 'mock' });
        return { runId: run.id };
      },
      startBotRun: unused,
      cancelRun: unused,
      cancelBotRuns: unused,
      recoverInterruptedRuns: unused,
      resetEngineSessions: unused,
      shutdown: () => undefined,
    },
  };
}

function newScheduler(harness: Harness, options: { now?: () => Date } = {}): Scheduler {
  const scheduler = createScheduler({
    repos: ctx.services.repos,
    harness,
    bus: ctx.services.bus,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  schedulers.push(scheduler);
  return scheduler;
}

/** An app wired to a fake harness and scheduler, for routes whose run never finishes on its own. */
function appWith(scheduler: Scheduler, harness: Harness) {
  return createApp({
    ...ctx.services,
    harness,
    scheduler,
    config: { host: '127.0.0.1', port: 8799, mode: 'server' },
    trustLoopback: true,
  });
}

/** Creates a bot and a routine straight in the database, without the routes' rescheduling. */
async function seedRoutine(
  input: {
    name?: string;
    cron?: string;
    timezone?: string;
    enabled?: boolean;
    catchUp?: boolean;
    rememberLastRun?: boolean;
    lastRunAt?: string;
    instruction?: string;
  } = {},
): Promise<{ bot: Bot; routine: Routine }> {
  const repos = ctx.services.repos;
  const bot = await repos.bots.create({ name: 'Ada', job: 'Operations' });
  const cron = input.cron ?? '0 9 * * *';
  const routine = await repos.routines.create({
    botId: bot.id,
    name: input.name ?? 'Daily digest',
    instruction: input.instruction ?? 'Summarise the inbox.',
    trigger: input.timezone === undefined ? { type: 'cron', cron } : { type: 'cron', cron, timezone: input.timezone },
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.catchUp === undefined ? {} : { catchUp: input.catchUp }),
    ...(input.rememberLastRun === undefined ? {} : { rememberLastRun: input.rememberLastRun }),
  });
  if (input.lastRunAt !== undefined) await repos.routines.update(routine.id, { lastRunAt: input.lastRunAt });
  return { bot, routine };
}

async function waitForRun(id: string, predicate: (run: RoutineRun) => boolean): Promise<RoutineRun> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const run = await ctx.services.repos.routineRuns.get(id);
    if (run !== undefined && predicate(run)) return run;
    if (Date.now() > deadline) throw new Error(`routine run ${id} did not reach the expected state`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForHistory(
  routineId: string,
  predicate: (runs: RoutineRun[]) => boolean,
): Promise<RoutineRun[]> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const runs = await ctx.services.repos.routineRuns.listByRoutine(routineId);
    if (predicate(runs)) return runs;
    if (Date.now() > deadline) throw new Error(`routine ${routineId} did not produce the expected run history`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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
    expect(routine.catchUp).toBe(true);
    expect(routine.rememberLastRun).toBe(false);

    const events = recordEvents(ctx.services.bus);
    const first = (await (await call(ctx.app, 'POST', `/api/routines/${routine.id}/run`)).json()) as { runId: string };
    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === first.runId));

    const afterRun = (await (await call(ctx.app, 'GET', `/api/routines`)).json()) as Routine[];
    expect(afterRun[0]?.lastRunAt).toBeDefined();

    await call(ctx.app, 'POST', `/api/routines/${routine.id}/run`);
    const threads = (await (await call(ctx.app, 'GET', `/api/bots/${bot.id}/threads`)).json()) as {
      id: string;
      title: string;
    }[];
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
    const disabled = (await patched.json()) as Routine;
    expect(disabled.enabled).toBe(false);
    expect(disabled.nextRunAt).toBeUndefined();
    expect(
      ((await (await call(ctx.app, 'GET', '/api/routines')).json()) as Routine[]).find((item) => item.id === routine.id)
        ?.nextRunAt,
    ).toBeUndefined();

    const reenabled = await call(ctx.app, 'PATCH', `/api/routines/${routine.id}`, { enabled: true });
    expect(((await reenabled.json()) as Routine).nextRunAt).toBeDefined();
    expect((await call(ctx.app, 'DELETE', `/api/routines/${routine.id}`)).status).toBe(204);
    expect((await call(ctx.app, 'POST', `/api/routines/${routine.id}/run`)).status).toBe(404);
  });
});

describe('routine routes', () => {
  it('records a manual run with its result and lists it in the routine history', async () => {
    const bot = await createBot();
    const routine = await createRoutine(bot.id);
    const events = recordEvents(ctx.services.bus);

    const res = await call(ctx.app, 'POST', `/api/routines/${routine.id}/run`);
    expect(res.status).toBe(202);
    const { runId } = (await res.json()) as { runId: string };
    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === runId));

    const runs = await waitForHistory(routine.id, (history) => history[0]?.status === 'completed');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      routineId: routine.id,
      botId: bot.id,
      runId,
      trigger: 'manual',
      status: 'completed',
      result: 'You said: Summarise the day.',
    });
    expect(runs[0]?.threadId).toBeDefined();
    expect(runs[0]?.endedAt).toBeDefined();

    const byRoutine = (await (await call(ctx.app, 'GET', `/api/routines/${routine.id}/runs`)).json()) as RoutineRun[];
    expect(byRoutine).toEqual(runs);
    const completed = (await (
      await call(ctx.app, 'GET', `/api/routine-runs?routineId=${routine.id}&status=completed`)
    ).json()) as RoutineRun[];
    expect(completed.map((run) => run.id)).toEqual([runs[0]?.id]);
    events.stop();
  });

  it('accepts a timezone and rejects an unknown one, and reschedules on update', async () => {
    const bot = await createBot();
    const utc = await createRoutine(bot.id, {
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'UTC' },
      catchUp: false,
      rememberLastRun: true,
    });
    expect(utc).toMatchObject({
      catchUp: false,
      rememberLastRun: true,
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'UTC' },
    });
    expect(new Date(utc.nextRunAt ?? '').getUTCHours()).toBe(9);

    const invalid = await call(ctx.app, 'POST', '/api/routines', {
      botId: bot.id,
      name: 'Broken zone',
      instruction: 'x',
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'Mars/Olympus' },
    });
    expect(invalid.status).toBe(400);
    const issues = (await invalid.json()) as { issues: { path: string[] }[] };
    expect(issues.issues[0]?.path).toEqual(['trigger', 'timezone']);

    const patched = await call(ctx.app, 'PATCH', `/api/routines/${utc.id}`, {
      trigger: { type: 'cron', cron: '30 18 * * *', timezone: 'America/Sao_Paulo' },
      rememberLastRun: false,
    });
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as Routine;
    expect(updated).toMatchObject({ rememberLastRun: false, trigger: { timezone: 'America/Sao_Paulo' } });
    expect(new Date(updated.nextRunAt ?? '').getUTCHours()).toBe(21);
    expect(new Date(updated.nextRunAt ?? '').getUTCMinutes()).toBe(30);

    const badPatch = await call(ctx.app, 'PATCH', `/api/routines/${utc.id}`, {
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'Not/AZone' },
    });
    expect(badPatch.status).toBe(400);
  });

  it('answers 404 for an unknown routine and 400 for an invalid filter or limit', async () => {
    expect((await call(ctx.app, 'GET', '/api/routines/nope/runs')).status).toBe(404);

    const bot = await createBot();
    const routine = await createRoutine(bot.id);
    expect((await call(ctx.app, 'GET', `/api/routines/${routine.id}/runs?limit=0`)).status).toBe(400);
    expect((await call(ctx.app, 'GET', `/api/routines/${routine.id}/runs?limit=abc`)).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/routine-runs?limit=-3')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/routine-runs?status=paused')).status).toBe(400);
  });

  it('orders history newest first, defaults to 50, and clamps the limit to 200', async () => {
    const bot = await createBot();
    const routine = await createRoutine(bot.id);
    const thread = await ctx.services.repos.threads.create(bot.id, { title: 'Daily digest' });
    const base = Date.parse('2026-10-01T00:00:00.000Z');
    for (let index = 0; index < 205; index += 1) {
      await ctx.services.repos.routineRuns.create({
        routineId: routine.id,
        botId: bot.id,
        threadId: thread.id,
        trigger: 'schedule',
        status: 'completed',
        startedAt: new Date(base + index * 60_000).toISOString(),
      });
    }

    const defaulted = (await (await call(ctx.app, 'GET', `/api/routines/${routine.id}/runs`)).json()) as RoutineRun[];
    expect(defaulted).toHaveLength(50);
    expect(defaulted[0]?.startedAt).toBe(new Date(base + 204 * 60_000).toISOString());

    const clamped = (await (
      await call(ctx.app, 'GET', `/api/routines/${routine.id}/runs?limit=500`)
    ).json()) as RoutineRun[];
    expect(clamped).toHaveLength(200);
    expect(clamped[0]?.startedAt).toBe(new Date(base + 204 * 60_000).toISOString());
    expect(clamped[199]?.startedAt).toBe(new Date(base + 5 * 60_000).toISOString());

    const filtered = (await (
      await call(ctx.app, 'GET', `/api/routine-runs?botId=${bot.id}&limit=2`)
    ).json()) as RoutineRun[];
    expect(filtered).toHaveLength(2);
  });

  it('answers 409 and records a skipped run when the routine is already running', async () => {
    const { harness } = fakeHarness();
    const scheduler = newScheduler(harness);
    const app = appWith(scheduler, harness);
    const { routine } = await seedRoutine();

    const first = await call(app, 'POST', `/api/routines/${routine.id}/run`);
    expect(first.status).toBe(202);
    const { runId } = (await first.json()) as { runId: string };

    const second = await call(app, 'POST', `/api/routines/${routine.id}/run`);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'Routine is already running' });

    const runs = await ctx.services.repos.routineRuns.listByRoutine(routine.id);
    expect(runs.find((run) => run.status === 'running')?.runId).toBe(runId);
    expect(runs.find((run) => run.status === 'skipped')).toMatchObject({ error: 'already running', trigger: 'manual' });

    const active = runs.find((run) => run.status === 'running');
    if (active === undefined) throw new Error('the first run must still be active');
    await ctx.services.repos.messages.create({ threadId: active.threadId, role: 'assistant', content: 'Done.' });
    await ctx.services.bus.publish({ type: 'run.completed', threadId: active.threadId, runId });
    await waitForRun(active.id, (run) => run.status === 'completed');

    expect((await call(app, 'POST', `/api/routines/${routine.id}/run`)).status).toBe(202);
  });
});

describe('routine scheduler', () => {
  it('starts a run, records it, captures the assistant text trimmed to 4000 characters, and links the engine run', async () => {
    const { harness } = fakeHarness();
    const scheduler = newScheduler(harness);
    const { routine } = await seedRoutine();

    const started = await scheduler.runRoutineNow(routine.id);
    if (started?.status !== 'running') throw new Error('the run must start');
    const record = await waitForRun(started.routineRunId, () => true);
    expect(record).toMatchObject({
      routineId: routine.id,
      trigger: 'manual',
      status: 'running',
      runId: started.runId,
    });
    expect((await ctx.services.repos.threads.get(record.threadId))?.title).toBe('Daily digest');

    await ctx.services.repos.messages.create({
      threadId: record.threadId,
      role: 'assistant',
      content: 'x'.repeat(5000),
    });
    await ctx.services.bus.publish({ type: 'run.completed', threadId: record.threadId, runId: started.runId });

    const completed = await waitForRun(record.id, (run) => run.status === 'completed');
    expect(completed.result).toBe('x'.repeat(4000));
    expect(completed.endedAt).toBeDefined();
    expect((await ctx.services.repos.routines.get(routine.id))?.lastRunAt).toBeDefined();
  });

  it('marks the run failed with the engine error', async () => {
    const { harness } = fakeHarness();
    const scheduler = newScheduler(harness);
    const { routine } = await seedRoutine();

    const started = await scheduler.runRoutineNow(routine.id);
    if (started?.status !== 'running') throw new Error('the run must start');
    const record = await waitForRun(started.routineRunId, () => true);
    await ctx.services.bus.publish({
      type: 'run.failed',
      threadId: record.threadId,
      runId: started.runId,
      error: 'engine exploded',
    });

    const failed = await waitForRun(record.id, (run) => run.status === 'failed');
    expect(failed.error).toBe('engine exploded');
    expect(failed.endedAt).toBeDefined();
  });

  it('records a failed run when the harness refuses to start it', async () => {
    const failure = new Error('engine "nowhere" is not registered');
    const { harness } = fakeHarness({ failStart: failure });
    const scheduler = newScheduler(harness);
    const { routine } = await seedRoutine();

    await expect(scheduler.runRoutineNow(routine.id)).rejects.toThrow(failure.message);
    const [record] = await ctx.services.repos.routineRuns.listByRoutine(routine.id);
    expect(record).toMatchObject({ status: 'failed', error: failure.message });
    expect(record?.endedAt).toBeDefined();
  });

  it('prepends the last completed result, trimmed to 2000 characters, when rememberLastRun is on', async () => {
    const { harness, inputs } = fakeHarness();
    const scheduler = newScheduler(harness);
    const { routine } = await seedRoutine({ rememberLastRun: true });

    const first = await scheduler.runRoutineNow(routine.id);
    if (first?.status !== 'running') throw new Error('the run must start');
    expect(inputs[0]?.input).toBe('Summarise the inbox.');
    const record = await waitForRun(first.routineRunId, () => true);
    await ctx.services.repos.messages.create({
      threadId: record.threadId,
      role: 'assistant',
      content: 'a'.repeat(3000),
    });
    await ctx.services.bus.publish({ type: 'run.completed', threadId: record.threadId, runId: first.runId });
    await waitForRun(record.id, (run) => run.status === 'completed');

    const second = await scheduler.runRoutineNow(routine.id);
    expect(second?.status).toBe('running');
    expect(inputs[1]?.input).toBe(`Previous run result:\n${'a'.repeat(2000)}\n\nSummarise the inbox.`);
  });

  it('leaves the instruction alone when rememberLastRun is off', async () => {
    const { harness, inputs } = fakeHarness();
    const scheduler = newScheduler(harness);
    const { routine } = await seedRoutine();

    const first = await scheduler.runRoutineNow(routine.id);
    if (first?.status !== 'running') throw new Error('the run must start');
    const record = await waitForRun(first.routineRunId, () => true);
    await ctx.services.repos.messages.create({ threadId: record.threadId, role: 'assistant', content: 'Done.' });
    await ctx.services.bus.publish({ type: 'run.completed', threadId: record.threadId, runId: first.runId });
    await waitForRun(record.id, (run) => run.status === 'completed');

    expect((await scheduler.runRoutineNow(routine.id))?.status).toBe('running');
    expect(inputs[1]?.input).toBe('Summarise the inbox.');
  });

  it('catches up one missed occurrence per boot, skips disabled and opted-out routines', async () => {
    const { harness, inputs } = fakeHarness();
    const clock = (): Date => new Date('2026-01-01T10:00:00.000Z');
    const scheduler = newScheduler(harness, { now: clock });
    const lastRunAt = '2025-12-31T10:00:00.000Z';
    const { routine } = await seedRoutine({ cron: '0 9 1 1 *', timezone: 'UTC', lastRunAt });
    const { routine: disabled } = await seedRoutine({
      name: 'Disabled',
      cron: '0 9 1 1 *',
      timezone: 'UTC',
      enabled: false,
      lastRunAt,
    });
    const { routine: optedOut } = await seedRoutine({
      name: 'Opted out',
      cron: '0 9 1 1 *',
      timezone: 'UTC',
      catchUp: false,
      lastRunAt,
    });

    await scheduler.sync();
    expect(inputs).toHaveLength(1);

    const records = await ctx.services.repos.routineRuns.listByRoutine(routine.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ trigger: 'schedule', status: 'running' });
    expect((await ctx.services.repos.routines.get(routine.id))?.lastRunAt).not.toBe(lastRunAt);

    await scheduler.sync();
    expect(inputs).toHaveLength(1);
    expect(await ctx.services.repos.routineRuns.listByRoutine(disabled.id)).toEqual([]);
    expect(await ctx.services.repos.routineRuns.listByRoutine(optedOut.id)).toEqual([]);
  });

  it('fires a scheduled occurrence and records it with the schedule trigger', async () => {
    const { harness, inputs } = fakeHarness();
    const scheduler = newScheduler(harness);
    const app = appWith(scheduler, harness);
    const bot = await createBot();
    const created = await call(app, 'POST', '/api/routines', {
      botId: bot.id,
      name: 'Every second',
      instruction: 'Tick.',
      trigger: { type: 'cron', cron: '* * * * * *' },
    });
    expect(created.status).toBe(201);
    const routine = (await created.json()) as Routine;

    const runs = await waitForHistory(routine.id, (history) => history.some((run) => run.trigger === 'schedule'));
    expect(runs.find((run) => run.trigger === 'schedule')).toMatchObject({ status: 'running', botId: bot.id });
    expect(inputs.length).toBeGreaterThan(0);
    await call(app, 'DELETE', `/api/routines/${routine.id}`);
  });

  it('does not catch up while the routine is already running, and fires once that run ends', async () => {
    const { harness, inputs } = fakeHarness();
    const clock = (): Date => new Date('2026-01-01T10:00:00.000Z');
    const scheduler = newScheduler(harness, { now: clock });
    const { routine } = await seedRoutine({ cron: '0 9 1 1 *', timezone: 'UTC' });
    await scheduler.sync();

    const started = await scheduler.runRoutineNow(routine.id);
    if (started?.status !== 'running') throw new Error('the run must start');
    expect(inputs).toHaveLength(1);
    await ctx.services.repos.routines.update(routine.id, { lastRunAt: '2025-12-31T10:00:00.000Z' });

    await scheduler.sync();
    expect(inputs).toHaveLength(1);

    const record = await waitForRun(started.routineRunId, () => true);
    await ctx.services.repos.messages.create({ threadId: record.threadId, role: 'assistant', content: 'Done.' });
    await ctx.services.bus.publish({ type: 'run.completed', threadId: record.threadId, runId: started.runId });
    await waitForRun(started.routineRunId, (run) => run.status === 'completed');

    await scheduler.sync();
    expect(inputs).toHaveLength(2);
    const schedule = (await ctx.services.repos.routineRuns.listByRoutine(routine.id)).filter(
      (run) => run.trigger === 'schedule',
    );
    expect(schedule).toHaveLength(1);
  });

  it('fails runs a previous process left active, so a routine is not blocked forever', async () => {
    const { harness, inputs } = fakeHarness();
    const scheduler = newScheduler(harness);
    const { bot, routine } = await seedRoutine();
    const thread = await ctx.services.repos.threads.create(bot.id, { title: 'Daily digest' });
    const leftover = await ctx.services.repos.routineRuns.create({
      routineId: routine.id,
      botId: bot.id,
      threadId: thread.id,
      trigger: 'schedule',
      status: 'running',
    });

    await scheduler.sync();
    expect(await ctx.services.repos.routineRuns.get(leftover.id)).toMatchObject({
      status: 'failed',
      error: 'server restarted',
    });
    await scheduler.runRoutineNow(routine.id);
    expect(inputs).toHaveLength(1);
  });
});

describe('missed occurrences', () => {
  const job = new Cron('0 9 * * *', { timezone: 'UTC', paused: true });

  it('uses a 12 hour window', () => {
    expect(CATCH_UP_WINDOW_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('returns the missed occurrence when the last run came before it, inside the window', () => {
    const now = new Date('2026-01-02T10:00:00.000Z');
    expect(missedOccurrence(job, '2026-01-01T08:00:00.000Z', now)?.toISOString()).toBe('2026-01-02T09:00:00.000Z');
    expect(missedOccurrence(job, '2026-01-02T09:30:00.000Z', now)).toBeUndefined();
  });

  it('never fires an occurrence older than 12 hours', () => {
    const now = new Date('2026-01-02T22:00:00.000Z');
    expect(missedOccurrence(job, '2026-01-01T08:00:00.000Z', now)).toBeUndefined();
  });
});
