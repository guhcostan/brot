import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot, Notification, Thread } from '@brot/protocol';
import { createTestContext, waitUntil, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await ctx.close();
});

async function botAndThread(overrides: Record<string, unknown> = {}): Promise<{ bot: Bot; thread: Thread }> {
  const bot = await ctx.services.repos.bots.create({ name: 'Ada', job: 'Researcher', engine: 'mock', ...overrides });
  const thread = await ctx.services.repos.threads.create(bot.id, { title: 'Chat' });
  return { bot, thread };
}

async function startRun(bot: Bot, thread: Thread): Promise<string> {
  const run = await ctx.services.repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
  return run.id;
}

async function publishApproval(bot: Bot, thread: Thread, runId: string, summary = 'Send the invoice'): Promise<void> {
  const approval = await ctx.services.repos.approvals.create({
    runId,
    threadId: thread.id,
    botId: bot.id,
    kind: 'send',
    tool: 'send_email',
    summary,
    args: {},
  });
  await ctx.services.bus.publish({ type: 'approval.requested', threadId: thread.id, runId, approval });
}

/** Waits for the bus handler to write a matching record. */
async function waitForNotification(predicate: (notification: Notification) => boolean): Promise<Notification> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const found = (await ctx.services.repos.notifications.list()).find(predicate);
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error('timed out waiting for a notification');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('approval notifications', () => {
  it('records the approval summary with the asking bot', async () => {
    const { bot, thread } = await botAndThread();
    const runId = await startRun(bot, thread);
    await publishApproval(bot, thread, runId);

    const record = await waitForNotification((item) => item.kind === 'approval');
    expect(record).toMatchObject({
      botId: bot.id,
      threadId: thread.id,
      kind: 'approval',
      title: `"Ada" needs your approval`,
      body: 'Send the invoice',
    });
  });

  it('trims a long summary to 300 characters', async () => {
    const { bot, thread } = await botAndThread();
    const runId = await startRun(bot, thread);
    await publishApproval(bot, thread, runId, 'x'.repeat(400));

    const record = await waitForNotification((item) => item.kind === 'approval');
    expect(record.body).toHaveLength(300);
  });

  it('notifies even when the bot turned notifications off, because a blocked run needs a person', async () => {
    const { bot, thread } = await botAndThread({ notifications: false });
    const runId = await startRun(bot, thread);
    await publishApproval(bot, thread, runId);

    expect((await waitForNotification((item) => item.kind === 'approval')).kind).toBe('approval');
  });
});

describe('finished notifications', () => {
  it('records the start of the run’s last assistant message', async () => {
    const { bot, thread } = await botAndThread();
    const content = 'Here is the report. '.repeat(30);
    await ctx.services.repos.messages.create({ threadId: thread.id, role: 'assistant', content, authorBotId: bot.id });
    const runId = await startRun(bot, thread);
    await ctx.services.bus.publish({ type: 'run.completed', threadId: thread.id, runId });

    const record = await waitForNotification((item) => item.kind === 'finished');
    expect(record).toMatchObject({
      botId: bot.id,
      threadId: thread.id,
      kind: 'finished',
      title: `"Ada" finished`,
      body: content.trim().slice(0, 300),
    });
    expect(record.body).toHaveLength(300);
  });

  it('skips finished when the bot turned notifications off', async () => {
    const { bot, thread } = await botAndThread({ notifications: false });
    await ctx.services.repos.messages.create({ threadId: thread.id, role: 'assistant', content: 'Done.', authorBotId: bot.id });
    const runId = await startRun(bot, thread);
    await ctx.services.bus.publish({ type: 'run.completed', threadId: thread.id, runId });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(await ctx.services.repos.notifications.list()).toEqual([]);
  });

  it('skips finished when the answer is empty or missing', async () => {
    const { bot, thread } = await botAndThread();
    const empty = await ctx.services.repos.messages.create({ threadId: thread.id, role: 'assistant', content: '   ', authorBotId: bot.id });
    const runId = await startRun(bot, thread);
    await ctx.services.bus.publish({ type: 'run.completed', threadId: thread.id, runId });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(empty.content).toBe('   ');
    expect(await ctx.services.repos.notifications.list()).toEqual([]);

    const other = await botAndThread({ name: 'Bo' });
    const otherRun = await startRun(other.bot, other.thread);
    await ctx.services.bus.publish({ type: 'run.completed', threadId: other.thread.id, runId: otherRun });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await ctx.services.repos.notifications.list()).toEqual([]);
  });
});

describe('failed notifications', () => {
  it('records the run error and notifies even with notifications off', async () => {
    const { bot, thread } = await botAndThread({ notifications: false });
    const runId = await startRun(bot, thread);
    await ctx.services.bus.publish({ type: 'run.failed', threadId: thread.id, runId, error: 'the provider refused the key' });

    expect(await waitForNotification((item) => item.kind === 'failed')).toMatchObject({
      botId: bot.id,
      kind: 'failed',
      title: `"Ada" failed`,
      body: 'the provider refused the key',
    });
  });

  it('ignores an event whose run or bot is gone', async () => {
    const { bot, thread } = await botAndThread();
    const runId = await startRun(bot, thread);
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

    const bots = vi.spyOn(ctx.services.repos.bots, 'get').mockResolvedValue(undefined);
    await ctx.services.bus.publish({ type: 'run.failed', threadId: thread.id, runId, error: 'gone' });
    await settle();
    bots.mockRestore();

    const runs = vi.spyOn(ctx.services.repos.runs, 'get').mockResolvedValue(undefined);
    await ctx.services.bus.publish({ type: 'run.failed', threadId: thread.id, runId, error: 'gone' });
    await settle();
    runs.mockRestore();

    expect(await ctx.services.repos.notifications.list()).toEqual([]);
  });
});

describe('a broken inbox never blocks the bus', () => {
  it('logs and swallows a repo failure', async () => {
    const { bot, thread } = await botAndThread();
    const runId = await startRun(bot, thread);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(ctx.services.repos.runs, 'get').mockRejectedValue(new Error('the database is down'));

    await expect(ctx.services.bus.publish({ type: 'run.failed', threadId: thread.id, runId, error: 'boom' })).resolves.toBeDefined();
    await waitUntil(() => (errors.mock.calls.length > 0 ? true : undefined));
    expect(errors.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('run.failed');
    expect(await ctx.services.repos.notifications.list()).toEqual([]);
  });
});

describe('retention', () => {
  it('prunes records older than 30 days, idempotently', async () => {
    const { bot, thread } = await botAndThread();
    await ctx.services.repos.notifications.create({
      botId: bot.id,
      threadId: thread.id,
      kind: 'finished',
      title: '"Ada" finished',
      body: 'Old.',
      createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const recent = await ctx.services.repos.notifications.create({
      botId: bot.id,
      threadId: thread.id,
      kind: 'finished',
      title: '"Ada" finished',
      body: 'Recent.',
    });

    expect(await ctx.services.notifications.prune()).toBe(1);
    expect((await ctx.services.repos.notifications.list()).map((item) => item.id)).toEqual([recent.id]);
    expect(await ctx.services.notifications.prune()).toBe(0);
  });
});
