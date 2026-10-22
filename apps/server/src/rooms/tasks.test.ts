import type { Bot, CanonicalEvent, Task, Thread } from '@brot/protocol';
import { TEAM_MAX_TASKS_PER_CHAIN } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunContext } from '@brot/protocol';
import { call, recordEvents, type TestContext } from '../testing';
import { addBot, closeContexts, createDm, json, listMessages, openContext, recordingEngine, until, type Recording } from './fixtures';

afterEach(closeContexts);

interface Team {
  ctx: TestContext;
  recording: Recording;
  capy: Bot;
  dex: Bot;
  ivy: Bot;
  capyDm: Thread;
}

async function team(costUsd?: number): Promise<Team> {
  const recording = recordingEngine({ costUsd });
  const ctx = await openContext(recording);
  const capy = await addBot(ctx, 'Capy');
  return {
    ctx,
    recording,
    capy,
    dex: await addBot(ctx, 'Dex', costUsd === undefined ? {} : { teamBudgetUsd: 0.2 }),
    ivy: await addBot(ctx, 'Ivy'),
    capyDm: await createDm(ctx, capy.id),
  };
}

async function createTask(ctx: TestContext, body: Record<string, unknown>): Promise<Response> {
  return call(ctx.app, 'POST', '/api/tasks', body);
}

async function fetchTask(ctx: TestContext, id: string): Promise<Task & { children: Task[] }> {
  return json<Task & { children: Task[] }>(await call(ctx.app, 'GET', `/api/tasks/${id}`));
}

/**
 * Waits until a task's work run has ended. SQLite runs one writer at a time, so a task created while an
 * earlier run is still writing can fail with SQLITE_BUSY; the tests create tasks one at a time.
 */
async function settle(ctx: TestContext, id: string): Promise<void> {
  await until(async () => {
    const status = (await fetchTask(ctx, id)).status;
    return status === 'done' || status === 'failed';
  });
}

describe('tasks API', () => {
  it('creates a user task at depth 0 and starts the assignee in its DM until the run ends', async () => {
    const { ctx, recording, dex, capyDm } = await team();
    const events = recordEvents(ctx.services.bus);
    const response = await createTask(ctx, {
      title: 'Summarize the notes',
      description: 'Keep it short',
      assigneeBotId: dex.id,
      threadId: capyDm.id,
    });
    expect(response.status).toBe(201);
    const created = await json<Task>(response);
    expect(created).toMatchObject({ createdByUser: true, depth: 0, chainId: created.id, status: 'in_progress' });

    const dexDm = (await ctx.services.repos.threads.listByBot(dex.id, { kind: 'dm' }))[0]!;
    expect(created.workThreadId).toBe(dexDm.id);
    const names = events.list.filter((event): event is CanonicalEvent & { type: 'task.created' | 'task.updated' } =>
      event.type === 'task.created' || event.type === 'task.updated',
    );
    expect(names.map((event) => event.type)).toEqual(['task.created', 'task.updated']);

    await until(async () => (await fetchTask(ctx, created.id)).status === 'done');
    const finished = await fetchTask(ctx, created.id);
    expect(finished.result).toContain('Keep it short');
    expect(recording.runs[0]).toMatchObject({ bot: expect.objectContaining({ name: 'Dex' }) });
    expect(recording.runs[0]?.input).toContain(`Task id: ${created.id}`);
    expect(finished.children).toEqual([]);

    const listed = await json<Task[]>(await call(ctx.app, 'GET', `/api/tasks?assigneeBotId=${dex.id}`));
    expect(listed.map((task) => task.id)).toEqual([created.id]);
    expect((await call(ctx.app, 'GET', '/api/tasks?status=nope')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/tasks/missing')).status).toBe(404);
  });

  it('refuses to change a task that already ended, and rejects unknown references', async () => {
    const { ctx, dex, capyDm } = await team();
    const created = await json<Task>(
      await createTask(ctx, { title: 'Quick check', assigneeBotId: dex.id, threadId: capyDm.id }),
    );
    await until(async () => (await fetchTask(ctx, created.id)).status === 'done');

    const patch = await call(ctx.app, 'PATCH', `/api/tasks/${created.id}`, { status: 'blocked' });
    expect(patch.status).toBe(409);
    expect((await call(ctx.app, 'PATCH', '/api/tasks/missing', { status: 'blocked' })).status).toBe(404);

    const unknown = await createTask(ctx, { title: 'x', assigneeBotId: 'nobody', threadId: capyDm.id });
    expect(unknown.status).toBe(400);
  });

  it('answers 409 when a delegation goes past the depth limit', async () => {
    const { ctx, capy, dex, ivy, capyDm } = await team();
    let parent = await json<Task>(await createTask(ctx, { title: 'root', assigneeBotId: dex.id, threadId: capyDm.id }));
    await settle(ctx, parent.id);
    for (let depth = 1; depth <= 3; depth += 1) {
      const response = await createTask(ctx, {
        title: `step ${depth}`,
        assigneeBotId: ivy.id,
        createdByBotId: capy.id,
        parentTaskId: parent.id,
        threadId: capyDm.id,
      });
      expect(response.status).toBe(201);
      parent = await json<Task>(response);
      expect(parent.depth).toBe(depth);
      await settle(ctx, parent.id);
    }
    const tooDeep = await createTask(ctx, {
      title: 'too deep',
      assigneeBotId: ivy.id,
      createdByBotId: capy.id,
      parentTaskId: parent.id,
      threadId: capyDm.id,
    });
    expect(tooDeep.status).toBe(409);
    expect(await tooDeep.json()).toMatchObject({ error: expect.stringMatching(/depth/) });
  });

  it('answers 409 when a chain already holds its maximum number of tasks', async () => {
    const { ctx, capy, dex, ivy, capyDm } = await team();
    const root = await json<Task>(await createTask(ctx, { title: 'root', assigneeBotId: dex.id, threadId: capyDm.id }));
    await settle(ctx, root.id);
    for (let index = 1; index < TEAM_MAX_TASKS_PER_CHAIN; index += 1) {
      const response = await createTask(ctx, {
        title: `child ${index}`,
        assigneeBotId: ivy.id,
        createdByBotId: capy.id,
        parentTaskId: root.id,
        threadId: capyDm.id,
      });
      expect(response.status).toBe(201);
      await settle(ctx, (await json<Task>(response)).id);
    }
    const overflow = await createTask(ctx, {
      title: 'overflow',
      assigneeBotId: ivy.id,
      createdByBotId: capy.id,
      parentTaskId: root.id,
      threadId: capyDm.id,
    });
    expect(overflow.status).toBe(409);
  });

  it('a delegated task starts at depth 1 and ends with its run', async () => {
    const { ctx, capy, dex, capyDm } = await team();
    const created = await json<Task>(
      await createTask(ctx, { title: 'delegated', assigneeBotId: dex.id, createdByBotId: capy.id, threadId: capyDm.id }),
    );
    expect(created).toMatchObject({ createdByUser: false, createdByBotId: capy.id, depth: 1 });
    await settle(ctx, created.id);
    expect((await fetchTask(ctx, created.id)).status).toBe('done');
  });

  it('cancelling a task stops its work run', async () => {
    const recording = recordingEngine({ holdUntilCancelled: true });
    const ctx = await openContext(recording);
    const dex = await addBot(ctx, 'Dex');
    const dexDm = await createDm(ctx, dex.id);
    const created = await json<Task>(
      await createTask(ctx, { title: 'Long job', assigneeBotId: dex.id, threadId: dexDm.id }),
    );
    await until(async () => (await fetchTask(ctx, created.id)).workRunId !== undefined);
    await until(() => recording.runs.length === 1);
    const { workRunId } = await fetchTask(ctx, created.id);
    expect(recording.runs[0]?.signal.aborted).toBe(false);

    const cancelled = await call(ctx.app, 'PATCH', `/api/tasks/${created.id}`, { status: 'cancelled' });
    expect(cancelled.status).toBe(200);
    expect(await json<Task>(cancelled)).toMatchObject({ status: 'cancelled', workRunId });
    expect(recording.runs[0]?.signal.aborted).toBe(true);
    expect((await ctx.services.repos.runs.get(workRunId!))?.status).toBe('cancelled');
    expect((await fetchTask(ctx, created.id)).status).toBe('cancelled');
  });

  it('fails a task whose assignee cannot start, and says why', async () => {
    const { ctx, capy, capyDm } = await team();
    const zed = await addBot(ctx, 'Zed', { teamBudgetUsd: 0 });
    const created = await json<Task>(
      await createTask(ctx, { title: 'over budget', assigneeBotId: zed.id, createdByBotId: capy.id, threadId: capyDm.id }),
    );
    expect(created).toMatchObject({ status: 'failed' });
    expect(created.result).toMatch(/budget/);
  });
});

describe('team runner', () => {
  it('runBot resolves with the final text, and runs inherit the chain they are started in', async () => {
    const { ctx, capy, dex, capyDm } = await team();
    const runner = ctx.services.teamRunner;
    const dexDm = await createDm(ctx, dex.id);
    const chain = { chainId: 'chain-1', depth: 1, askHops: 1 };

    const outcome = await runner.runBot({ botId: dex.id, threadId: dexDm.id, input: 'hello there', chain });
    expect(outcome).toMatchObject({ status: 'completed', text: 'Dex replies to: hello there' });
    expect(runner.chainOf(outcome.runId)).toEqual(chain);

    const child = await runner.runBot({
      botId: capy.id,
      threadId: capyDm.id,
      input: 'question',
      fromBotId: dex.id,
      chain: { ...chain, askHops: 2 },
    });
    expect(child.text).toBe('Capy replies to: [Dex]: question');
    expect(runner.chainOf(child.runId)).toEqual({ ...chain, askHops: 2 });
    expect(runner.chainOf('not-a-run')).toBeUndefined();

    const asked = (await listMessages(ctx, capyDm.id)).find((message) => message.content === 'question');
    expect(asked).toMatchObject({ role: 'user', authorBotId: dex.id, viaBotId: capy.id });
  });

  it('startBot returns the run id without waiting for the run to finish', async () => {
    const { ctx, dex } = await team();
    const dexDm = await createDm(ctx, dex.id);
    const started = await ctx.services.teamRunner.startBot({ botId: dex.id, threadId: dexDm.id, input: 'later' });
    expect(started.runId).toEqual(expect.any(String));
    const run = await ctx.services.repos.runs.get(started.runId);
    expect(run?.botId).toBe(dex.id);
  });

  it('refuses runs past the depth and hop limits', async () => {
    const { ctx, dex } = await team();
    const dexDm = await createDm(ctx, dex.id);
    const runner = ctx.services.teamRunner;
    await expect(
      runner.runBot({ botId: dex.id, threadId: dexDm.id, input: 'x', chain: { chainId: 'c', depth: 4, askHops: 1 } }),
    ).rejects.toThrow(/depth/);
    await expect(
      runner.runBot({ botId: dex.id, threadId: dexDm.id, input: 'x', chain: { chainId: 'c', depth: 1, askHops: 5 } }),
    ).rejects.toThrow(/hops/);
  });

  it('stops new work in a chain once a bot cap is spent, and reports what the chain cost', async () => {
    const { ctx, dex } = await team(0.25);
    const dexDm = await createDm(ctx, dex.id);
    const runner = ctx.services.teamRunner;
    const chain = { chainId: 'budgeted', depth: 1, askHops: 1 };

    await runner.runBot({ botId: dex.id, threadId: dexDm.id, input: 'first', chain });
    expect(runner.chainSpentUsd('budgeted')).toBeCloseTo(0.25);
    await expect(runner.runBot({ botId: dex.id, threadId: dexDm.id, input: 'second', chain })).rejects.toThrow(/budget/);
  });
});

/** A recording engine that holds its first run until it is cancelled, and answers every later run at once. */
function holdFirstRun(): Recording {
  const runs: RunContext[] = [];
  const base = recordingEngine();
  return {
    runs,
    driver: {
      ...base.driver,
      async *run(ctx) {
        runs.push(ctx);
        if (runs.length === 1) {
          await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true }));
          return;
        }
        yield { type: 'text.delta', delta: `answer to ${ctx.input}` };
      },
    },
  };
}

describe('task outcomes', () => {
  it('cancels a task whose queued work run is cancelled, and says why', async () => {
    const recording = holdFirstRun();
    const ctx = await openContext(recording);
    const dex = await addBot(ctx, 'Dex');
    const dexDm = await createDm(ctx, dex.id);
    const busy = await ctx.services.harness.startBotRun({ botId: dex.id, threadId: dexDm.id, input: 'busy' });
    await until(() => recording.runs.length === 1);

    const created = await json<Task>(await createTask(ctx, { title: 'Queued job', assigneeBotId: dex.id, threadId: dexDm.id }));
    expect(created.status).toBe('in_progress');
    await until(async () => (await fetchTask(ctx, created.id)).workRunId !== undefined);
    const { workRunId } = await fetchTask(ctx, created.id);
    expect((await ctx.services.repos.runs.get(workRunId!))?.status).toBe('running');
    expect(recording.runs).toHaveLength(1);

    expect((await call(ctx.app, 'POST', `/api/runs/${workRunId}/cancel`)).status).toBe(200);

    await until(async () => (await fetchTask(ctx, created.id)).status === 'cancelled');
    expect((await fetchTask(ctx, created.id)).result).toBe('Run cancelled.');
    expect(recording.runs).toHaveLength(1);
    await ctx.services.harness.cancelRun(busy.runId);
    await busy.settled;
  });

  it('fails a task whose work run fails, with the reason', async () => {
    const base = recordingEngine();
    const recording: Recording = {
      runs: [],
      driver: {
        ...base.driver,
        run() {
          throw new Error('model down');
        },
      },
    };
    const ctx = await openContext(recording);
    const dex = await addBot(ctx, 'Dex');
    const dexDm = await createDm(ctx, dex.id);

    const created = await json<Task>(await createTask(ctx, { title: 'Doomed', assigneeBotId: dex.id, threadId: dexDm.id }));

    await until(async () => (await fetchTask(ctx, created.id)).status === 'failed');
    expect((await fetchTask(ctx, created.id)).result).toBe('model down');
  });

  it('fails a task whose work run cannot start, before any engine turn', async () => {
    const recording = recordingEngine();
    const ctx = await openContext(recording, {});
    const dex = await ctx.services.repos.bots.create({
      name: 'Dex',
      job: 'Dex job',
      engine: 'mock',
      computer: 'sandbox',
      instructions: '',
    });
    const dexDm = await createDm(ctx, dex.id);

    const created = await json<Task>(await createTask(ctx, { title: 'Stuck', assigneeBotId: dex.id, threadId: dexDm.id }));

    await until(async () => (await fetchTask(ctx, created.id)).status === 'failed');
    expect((await fetchTask(ctx, created.id)).result).toMatch(/sandbox computer/);
    expect(recording.runs).toHaveLength(0);
  });

  it('fails tasks left in progress when the server restarts', async () => {
    const { ctx, dex, capyDm } = await team();
    const orphan = await ctx.services.repos.tasks.create({ title: 'Orphan', assigneeBotId: dex.id, threadId: capyDm.id });
    await ctx.services.repos.tasks.update(orphan.id, { status: 'in_progress' });

    await ctx.services.harness.recoverInterruptedRuns();

    expect(await fetchTask(ctx, orphan.id)).toMatchObject({ status: 'failed', result: 'server restarted' });
  });
});

describe('delegator notices', () => {
  it('queues a notice to a delegator that is still busy, and starts it when that run ends', async () => {
    const recording = holdFirstRun();
    const ctx = await openContext(recording);
    const capy = await addBot(ctx, 'Capy');
    const capyDm = await createDm(ctx, capy.id);
    const busy = await ctx.services.harness.startBotRun({ botId: capy.id, threadId: capyDm.id, input: 'still delegating' });
    await until(() => recording.runs.length === 1);

    const notice = await ctx.services.teamRunner.startBot({ botId: capy.id, threadId: capyDm.id, input: 'Task finished' });
    expect((await ctx.services.repos.runs.get(notice.runId))?.status).toBe('running');
    expect(recording.runs).toHaveLength(1);

    await ctx.services.harness.cancelRun(busy.runId);
    await busy.settled;
    await until(() => recording.runs.length === 2);
    expect(recording.runs[1]?.input).toBe('Task finished');
    expect((await notice.settled).status).toBe('completed');
  });
});

describe('delegated task settlement', () => {
  it('notifies the delegator once when a delegated task ends with its run and was never reported on', async () => {
    const { ctx, recording, capy, dex, capyDm } = await team();
    const created = await json<Task>(
      await createTask(ctx, { title: 'Delegated', assigneeBotId: dex.id, createdByBotId: capy.id, threadId: capyDm.id }),
    );

    await until(() => recording.runs.some((run) => run.bot.name === 'Capy'));
    await until(async () => (await fetchTask(ctx, created.id)).status === 'done');
    await new Promise((resolve) => setTimeout(resolve, 30));

    const notices = recording.runs.filter((run) => run.bot.name === 'Capy');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.input).toContain(`Task ${created.id} "Delegated"`);
    expect(notices[0]?.input).toContain('is done');
    expect(notices[0]?.input).toContain('Dex replies to:');
  });
});
