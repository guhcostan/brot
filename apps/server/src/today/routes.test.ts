import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TodaySummary as TodaySummarySchema,
  type Bot,
  type Routine,
  type RoutineRunStatus,
  type Run,
  type RunStatus,
  type TodaySummary,
} from '@brot/protocol';
import { createApp } from '../app';
import { call, createTestContext, type TestContext } from '../testing';
import { localMidnight, serverTimeZone } from './';

let ctx: TestContext;
const fixedNow = '2026-10-22T17:45:00.000Z';

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

/** An app whose Today default window is resolved against a pinned clock. */
function todayApp(nowIso = fixedNow) {
  return createApp({
    ...ctx.services,
    config: { host: '127.0.0.1', port: 8799, mode: 'server' },
    trustLoopback: true,
    now: () => new Date(nowIso),
  });
}

async function todayOf(app: ReturnType<typeof createApp>, query = ''): Promise<TodaySummary> {
  const res = await call(app, 'GET', `/api/today${query}`);
  expect(res.status).toBe(200);
  const summary = (await res.json()) as TodaySummary;
  expect(TodaySummarySchema.parse(summary)).toEqual(summary);
  return summary;
}

async function createBot(name: string): Promise<Bot> {
  return ctx.services.repos.bots.create({ name, job: 'Operations' });
}

async function createThread(bot: Bot): Promise<string> {
  return (await ctx.services.repos.threads.create(bot.id, { title: 'Chat' })).id;
}

interface SeedRunInput {
  startedAt: string;
  status?: RunStatus;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  /** `null` leaves the run open. Defaults to the start time for terminal runs. */
  endedAt?: string | null;
}

async function seedRun(bot: Bot, threadId: string, input: SeedRunInput): Promise<Run> {
  const run = await ctx.services.repos.runs.create({ threadId, botId: bot.id, engine: 'mock' });
  const running = input.status === 'running' || input.status === 'waiting_approval';
  await ctx.services.db.client.execute({
    sql: 'UPDATE runs SET started_at = ?, status = ?, tokens_in = ?, tokens_out = ?, cost_usd = ?, ended_at = ? WHERE id = ?',
    args: [
      input.startedAt,
      input.status ?? 'completed',
      input.tokensIn ?? 0,
      input.tokensOut ?? 0,
      input.costUsd ?? 0,
      input.endedAt === undefined ? (running ? null : input.startedAt) : input.endedAt,
      run.id,
    ],
  });
  const seeded = await ctx.services.repos.runs.get(run.id);
  if (seeded === undefined) throw new Error('the seeded run disappeared');
  return seeded;
}

async function addAssistantMessage(threadId: string, botId: string, content: string): Promise<void> {
  await ctx.services.repos.messages.create({ threadId, role: 'assistant', content, authorBotId: botId });
}

async function seedApproval(bot: Bot, threadId: string, status: 'pending' | 'allowed'): Promise<void> {
  const run = await ctx.services.repos.runs.create({ threadId, botId: bot.id, engine: 'mock' });
  const approval = await ctx.services.repos.approvals.create({
    runId: run.id,
    threadId,
    botId: bot.id,
    kind: 'send',
    tool: 'send_message',
    summary: 'Send the update',
    args: {},
  });
  if (status === 'allowed') await ctx.services.repos.approvals.resolve(approval.id, { decision: 'allow_once' });
  // Backdate the approval's run so it never lands in a test window by accident.
  await ctx.services.db.client.execute({
    sql: 'UPDATE runs SET started_at = ? WHERE id = ?',
    args: ['2026-10-20T00:00:00.000Z', run.id],
  });
}

async function routineFixture(bot: Bot): Promise<{ routine: Routine; threadId: string }> {
  const threadId = await createThread(bot);
  const routine = await ctx.services.repos.routines.create({
    botId: bot.id,
    name: 'Daily digest',
    instruction: 'Summarise.',
    trigger: { type: 'cron', cron: '0 9 * * *' },
  });
  return { routine, threadId };
}

describe('GET /api/today', () => {
  it('summarizes runs, per-bot shares, routine counts and pending approvals for today', async () => {
    const app = todayApp();
    const ada = await createBot('Ada');
    const grace = await createBot('Grace');
    const capy = await createBot('Capy');
    const adaThread = await createThread(ada);
    await seedRun(ada, adaThread, { startedAt: '2026-10-22T09:00:00.000Z', tokensIn: 10, tokensOut: 5, costUsd: 0.5 });
    await seedRun(ada, adaThread, {
      startedAt: '2026-10-22T10:00:00.000Z',
      status: 'failed',
      tokensIn: 20,
      tokensOut: 10,
      costUsd: 0.1,
    });
    await seedRun(ada, adaThread, { startedAt: '2026-10-21T23:00:00.000Z', costUsd: 9 });
    const graceThread = await createThread(grace);
    await seedRun(grace, graceThread, {
      startedAt: '2026-10-22T11:00:00.000Z',
      status: 'running',
      tokensIn: 5,
      tokensOut: 1,
      costUsd: 0.3,
    });
    const capyThread = await createThread(capy);
    await seedRun(capy, capyThread, { startedAt: '2026-10-22T12:00:00.000Z', tokensIn: 1, tokensOut: 1, costUsd: 0 });

    const { routine, threadId: routineThread } = await routineFixture(ada);
    const routineRuns: Array<{ status: RoutineRunStatus; startedAt: string }> = [
      { status: 'completed', startedAt: '2026-10-22T08:00:00.000Z' },
      { status: 'completed', startedAt: '2026-10-22T09:00:00.000Z' },
      { status: 'failed', startedAt: '2026-10-22T10:00:00.000Z' },
      { status: 'skipped', startedAt: '2026-10-22T11:00:00.000Z' },
      { status: 'running', startedAt: '2026-10-22T12:00:00.000Z' },
      { status: 'queued', startedAt: '2026-10-22T13:00:00.000Z' },
      { status: 'completed', startedAt: '2026-10-21T23:30:00.000Z' },
    ];
    for (const entry of routineRuns) {
      await ctx.services.repos.routineRuns.create({
        routineId: routine.id,
        botId: ada.id,
        threadId: routineThread,
        trigger: 'schedule',
        status: entry.status,
        startedAt: entry.startedAt,
      });
    }

    await seedApproval(ada, adaThread, 'pending');
    await seedApproval(ada, adaThread, 'pending');
    await seedApproval(ada, adaThread, 'allowed');

    const summary = await todayOf(app, '?tz=UTC');
    expect(summary.from).toBe('2026-10-22T00:00:00.000Z');
    expect(summary.to).toBe(fixedNow);
    expect(summary.totals).toMatchObject({ runs: 4, completed: 2, failed: 1, cancelled: 0, tokensIn: 36, tokensOut: 17 });
    expect(summary.totals.costUsd).toBeCloseTo(0.9, 10);
    expect(summary.byBot.map((bot) => bot.name)).toEqual(['Ada', 'Grace', 'Capy']);
    expect(summary.byBot[0]).toMatchObject({
      botId: ada.id,
      name: 'Ada',
      runs: 2,
      completed: 1,
      failed: 1,
      tokensIn: 30,
      tokensOut: 15,
    });
    expect(summary.byBot[1]).toMatchObject({ botId: grace.id, runs: 1, completed: 0, failed: 0, tokensIn: 5, tokensOut: 1 });
    expect(summary.routines).toEqual({ completed: 2, failed: 1, skipped: 1, running: 2 });
    expect(summary.pendingApprovals).toBe(2);
    expect(summary.highlights).toEqual([]);
  });

  it('defaults the window to local midnight of the pinned clock in the server zone', async () => {
    const app = todayApp();
    const bot = await createBot('Ada');
    const thread = await createThread(bot);
    await seedRun(bot, thread, { startedAt: '2026-10-22T09:00:00.000Z' });

    const summary = await todayOf(app);
    expect(summary.to).toBe(fixedNow);
    expect(summary.from).toBe(localMidnight(new Date(fixedNow), serverTimeZone()).toISOString());
  });

  it('honors an explicit tz for the default window', async () => {
    const app = todayApp('2026-10-22T02:30:00.000Z');
    const bot = await createBot('Ada');
    const thread = await createThread(bot);
    await seedRun(bot, thread, { startedAt: '2026-10-21T05:00:00.000Z' });
    await seedRun(bot, thread, { startedAt: '2026-10-21T01:00:00.000Z' });
    await seedRun(bot, thread, { startedAt: '2026-10-22T03:00:00.000Z' });

    const summary = await todayOf(app, '?tz=America/Sao_Paulo');
    expect(summary).toMatchObject({ from: '2026-10-21T03:00:00.000Z', to: '2026-10-22T02:30:00.000Z' });
    expect(summary.totals.runs).toBe(1);
  });

  it('highlights the five newest completed runs with a non-empty last assistant message', async () => {
    const app = todayApp();
    const ada = await createBot('Ada');
    const grace = await createBot('Grace');

    async function candidate(bot: Bot, finishedAt: string, content?: string): Promise<Run> {
      const thread = await createThread(bot);
      const seeded = await seedRun(bot, thread, { startedAt: finishedAt, endedAt: finishedAt });
      if (content !== undefined) await addAssistantMessage(thread, bot.id, content);
      return seeded;
    }

    const oldest = await candidate(ada, '2026-10-22T10:00:00.000Z', 'oldest result');
    await candidate(grace, '2026-10-22T11:00:00.000Z', '   ');
    const fourth = await candidate(ada, '2026-10-22T12:00:00.000Z');
    const third = await candidate(grace, '2026-10-22T13:00:00.000Z', 'third result');
    const second = await candidate(ada, '2026-10-22T14:00:00.000Z', 'second result');
    const long = await candidate(ada, '2026-10-22T15:00:00.000Z', `  ${'x'.repeat(250)}  `);
    const newest = await candidate(grace, '2026-10-22T16:00:00.000Z', 'newest result');
    const runningThread = await createThread(ada);
    const running = await seedRun(ada, runningThread, { startedAt: '2026-10-22T17:00:00.000Z' });
    await addAssistantMessage(runningThread, ada.id, 'running result');
    await ctx.services.db.client.execute({
      sql: 'UPDATE runs SET status = ?, ended_at = NULL WHERE id = ?',
      args: ['running', running.id],
    });

    const summary = await todayOf(app, '?tz=UTC');
    expect(summary.highlights).toHaveLength(5);
    expect(summary.highlights.map((highlight) => highlight.threadId)).toEqual([
      newest.threadId,
      long.threadId,
      second.threadId,
      third.threadId,
      oldest.threadId,
    ]);
    expect(summary.highlights.every((highlight) => !highlight.text.startsWith(' '))).toBe(true);
    expect(summary.highlights[0]).toMatchObject({
      botId: grace.id,
      botName: 'Grace',
      threadId: newest.threadId,
      text: 'newest result',
      at: '2026-10-22T16:00:00.000Z',
    });
    expect(summary.highlights[1]?.text).toBe('x'.repeat(200));
    expect(summary.highlights[4]).toMatchObject({ threadId: oldest.threadId, text: 'oldest result' });
    expect(summary.highlights.some((highlight) => highlight.threadId === fourth.threadId)).toBe(false);
  });

  it('returns zeros for an empty window while pending approvals stay workspace-wide, and rejects bad queries', async () => {
    const app = todayApp();
    const bot = await createBot('Ada');
    const thread = await createThread(bot);
    await seedApproval(bot, thread, 'pending');

    const empty = await todayOf(app, '?from=2030-01-01T00:00:00.000Z&to=2030-01-02T00:00:00.000Z&tz=UTC');
    expect(empty.totals).toEqual({ runs: 0, completed: 0, failed: 0, cancelled: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 });
    expect(empty.byBot).toEqual([]);
    expect(empty.routines).toEqual({ completed: 0, failed: 0, skipped: 0, running: 0 });
    expect(empty.highlights).toEqual([]);
    expect(empty.pendingApprovals).toBe(1);

    async function issuesAt(path: string): Promise<{ path: string[] }[]> {
      const res = await call(app, 'GET', path);
      expect(res.status).toBe(400);
      return ((await res.json()) as { issues: { path: string[] }[] }).issues;
    }

    expect((await issuesAt('/api/today?from=yesterday'))[0]?.path).toEqual(['from']);
    expect((await issuesAt('/api/today?tz=Mars/Olympus'))[0]?.path).toEqual(['tz']);
    expect(
      (await issuesAt('/api/today?from=2026-10-23T00:00:00.000Z&to=2026-10-22T00:00:00.000Z&tz=UTC'))[0]?.path,
    ).toEqual(['from']);
    expect((await issuesAt('/api/today?to=2026-10-22'))[0]?.path).toEqual(['to']);
  });
});
