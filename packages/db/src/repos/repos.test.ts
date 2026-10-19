import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@brot/protocol';
import { createDb, migrate, type BrotDb } from '../index';
import { createRepos, type Repos } from './index';

let handle: BrotDb;
let repos: Repos;

beforeEach(async () => {
  handle = await createDb(':memory:');
  await migrate(handle.db);
  repos = createRepos(handle.db);
});

afterEach(() => {
  handle.client.close();
});

async function seed() {
  const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
  const thread = await repos.threads.create(bot.id, { title: 'Chat' });
  const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
  return { bot, thread, run };
}

describe('bots', () => {
  it('applies CreateBot defaults', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
    expect(bot).toMatchObject({
      name: 'Ada',
      job: 'Researcher',
      instructions: '',
      engine: 'mock',
      computer: 'none',
      pinned: false,
      archived: false,
    });
    expect(bot.avatar).toBeUndefined();
    expect(bot.model).toBeUndefined();
    expect(await repos.bots.get(bot.id)).toEqual(bot);
  });

  it('rejects invalid input', async () => {
    await expect(repos.bots.create({ name: '', job: 'x' })).rejects.toThrow();
  });

  it('lists active bots unless archived ones are requested', async () => {
    const active = await repos.bots.create({ name: 'Active', job: 'x' });
    const archived = await repos.bots.create({ name: 'Old', job: 'x' });
    await repos.bots.update(archived.id, { archived: true });

    expect((await repos.bots.list()).map((b) => b.id)).toEqual([active.id]);
    expect((await repos.bots.list({ includeArchived: true })).map((b) => b.id).sort()).toEqual(
      [active.id, archived.id].sort(),
    );
  });

  it('updates fields and bumps updatedAt', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
    const updated = await repos.bots.update(bot.id, { name: 'Grace', pinned: true, computer: 'sandbox' });
    expect(updated).toMatchObject({ name: 'Grace', pinned: true, computer: 'sandbox', job: 'Researcher' });
    expect((updated?.updatedAt ?? '') >= bot.updatedAt).toBe(true);
    expect(await repos.bots.update('missing', { name: 'x' })).toBeUndefined();
  });

  it('removes a bot and reports missing ids', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    expect(await repos.bots.remove(bot.id)).toBe(true);
    expect(await repos.bots.remove(bot.id)).toBe(false);
    expect(await repos.bots.get(bot.id)).toBeUndefined();
  });
});

describe('threads', () => {
  it('creates threads with a default title and lists them per bot', async () => {
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    const other = await repos.bots.create({ name: 'Grace', job: 'x' });
    const named = await repos.threads.create(bot.id, { title: 'Plan' });
    const untitled = await repos.threads.create(bot.id);
    await repos.threads.create(other.id);

    expect(named.title).toBe('Plan');
    expect(untitled.title).toBe('New thread');
    expect((await repos.threads.listByBot(bot.id)).map((t) => t.id).sort()).toEqual(
      [named.id, untitled.id].sort(),
    );
  });

  it('touch bumps updatedAt', async () => {
    const { thread } = await seed();
    const touched = await repos.threads.touch(thread.id);
    expect((touched?.updatedAt ?? '') >= thread.updatedAt).toBe(true);
    expect(touched?.title).toBe(thread.title);
    expect(await repos.threads.touch('missing')).toBeUndefined();
  });
});

describe('messages', () => {
  it('stores messages in order and honours a pre-assigned id', async () => {
    const { thread } = await seed();
    const first = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'hi', id: 'msg-1' });
    const second = await repos.messages.create({ threadId: thread.id, role: 'assistant', content: 'hello' });

    expect(first.id).toBe('msg-1');
    expect((await repos.messages.listByThread(thread.id)).map((m) => m.content)).toEqual(['hi', 'hello']);
    expect(second.role).toBe('assistant');
  });

  it('rejects an unknown role', async () => {
    const { thread } = await seed();
    await expect(
      repos.messages.create({ threadId: thread.id, role: 'robot' as 'user', content: 'x' }),
    ).rejects.toThrow();
  });
});

describe('runs', () => {
  it('creates a running run and updates its totals', async () => {
    const { run, thread, bot } = await seed();
    expect(run).toMatchObject({ status: 'running', tokensIn: 0, tokensOut: 0, costUsd: 0, threadId: thread.id, botId: bot.id });

    const done = await repos.runs.update(run.id, {
      status: 'completed',
      tokensIn: 12,
      tokensOut: 34,
      costUsd: 0.5,
      endedAt: new Date().toISOString(),
    });
    expect(done).toMatchObject({ status: 'completed', tokensIn: 12, tokensOut: 34, costUsd: 0.5 });
    expect((await repos.runs.listByThread(thread.id)).map((r) => r.id)).toEqual([run.id]);
  });
});

describe('approvals', () => {
  const approvalInput = (runId: string, threadId: string, botId: string) => ({
    runId,
    threadId,
    botId,
    kind: 'send' as const,
    tool: 'gmail.send',
    summary: 'Send the weekly report',
    args: { to: 'team@example.com' },
  });

  it('creates pending approvals and filters by status', async () => {
    const { bot, thread, run } = await seed();
    const approval = await repos.approvals.create(approvalInput(run.id, thread.id, bot.id));
    expect(approval).toMatchObject({ status: 'pending', args: { to: 'team@example.com' } });

    expect((await repos.approvals.list({ status: 'pending' })).map((a) => a.id)).toEqual([approval.id]);
    expect(await repos.approvals.list({ status: 'allowed' })).toEqual([]);
  });

  it('resolves once and keeps the first decision', async () => {
    const { bot, thread, run } = await seed();
    const approval = await repos.approvals.create(approvalInput(run.id, thread.id, bot.id));

    const allowed = await repos.approvals.resolve(approval.id, { decision: 'allow_once', reply: 'ok' });
    expect(allowed).toMatchObject({ status: 'allowed', decision: 'allow_once', reply: 'ok' });
    expect(allowed?.resolvedAt).toBeDefined();

    const again = await repos.approvals.resolve(approval.id, { decision: 'deny' });
    expect(again).toEqual(allowed);
    expect(await repos.approvals.resolve('missing', { decision: 'deny' })).toBeUndefined();
  });

  it('denies when the decision is deny', async () => {
    const { bot, thread, run } = await seed();
    const approval = await repos.approvals.create(approvalInput(run.id, thread.id, bot.id));
    const denied = await repos.approvals.resolve(approval.id, { decision: 'deny' });
    expect(denied).toMatchObject({ status: 'denied', decision: 'deny' });
  });
});

describe('policies', () => {
  it('creates, lists per bot, and removes policies', async () => {
    const { bot } = await seed();
    const policy = await repos.policies.create(bot.id, { tool: 'shell', argPattern: 'ls *', effect: 'allow' });
    expect(policy).toMatchObject({ tool: 'shell', argPattern: 'ls *', effect: 'allow' });
    expect(await repos.policies.listByBot(bot.id)).toEqual([policy]);
    expect(await repos.policies.remove(policy.id)).toBe(true);
    expect(await repos.policies.listByBot(bot.id)).toEqual([]);
  });
});

describe('memories', () => {
  it('creates with a source run, updates content, and removes', async () => {
    const { bot, run } = await seed();
    const memory = await repos.memories.create(bot.id, { kind: 'fact', content: 'Likes tea', sourceRunId: run.id });
    expect(memory).toMatchObject({ kind: 'fact', content: 'Likes tea', sourceRunId: run.id });

    const updated = await repos.memories.update(memory.id, { content: 'Prefers green tea' });
    expect(updated).toMatchObject({ content: 'Prefers green tea', kind: 'fact' });
    expect((await repos.memories.get(memory.id))?.content).toBe('Prefers green tea');

    expect((await repos.memories.listByBot(bot.id)).map((m) => m.id)).toEqual([memory.id]);
    expect(await repos.memories.remove(memory.id)).toBe(true);
    expect(await repos.memories.get(memory.id)).toBeUndefined();
  });
});

describe('skills', () => {
  it('starts at version 1 and bumps the version on every update', async () => {
    const skill = await repos.skills.create({ name: 'summarize', description: 'Summarize', body: 'v1' });
    expect(skill.version).toBe(1);

    const v2 = await repos.skills.update(skill.id, { body: 'v2' });
    const v3 = await repos.skills.update(skill.id, { description: 'Short summary' });
    expect(v2).toMatchObject({ version: 2, body: 'v2' });
    expect(v3).toMatchObject({ version: 3, body: 'v2', description: 'Short summary' });
  });

  it('separates bot-owned and global skills', async () => {
    const { bot } = await seed();
    const other = await repos.bots.create({ name: 'Grace', job: 'x' });
    const global = await repos.skills.create({ name: 'global', description: 'd', body: 'b' });
    const owned = await repos.skills.create({ name: 'owned', description: 'd', body: 'b', botId: bot.id });
    const foreign = await repos.skills.create({ name: 'foreign', description: 'd', body: 'b', botId: other.id });

    expect((await repos.skills.list({ botId: bot.id })).map((s) => s.id)).toEqual([owned.id]);
    expect((await repos.skills.list()).map((s) => s.id).sort()).toEqual([global.id, owned.id, foreign.id].sort());
    expect((await repos.skills.listForBot(bot.id)).map((s) => s.id).sort()).toEqual([global.id, owned.id].sort());
    expect(await repos.skills.remove(global.id)).toBe(true);
  });
});

describe('routines', () => {
  it('defaults to enabled and finds webhook routines by secret', async () => {
    const { bot } = await seed();
    const cron = await repos.routines.create({
      botId: bot.id,
      name: 'Daily',
      instruction: 'Summarize news',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    const hook = await repos.routines.create({
      botId: bot.id,
      name: 'Deploy hook',
      instruction: 'Report deploy',
      trigger: { type: 'webhook', secret: 'hook-secret-123' },
      enabled: false,
    });

    expect(cron.enabled).toBe(true);
    expect(await repos.routines.findByWebhookSecret('hook-secret-123')).toEqual(hook);
    expect(await repos.routines.findByWebhookSecret('0 9 * * *')).toBeUndefined();
    expect(await repos.routines.findByWebhookSecret('unknown')).toBeUndefined();
    expect((await repos.routines.list({ botId: bot.id })).map((r) => r.id).sort()).toEqual(
      [cron.id, hook.id].sort(),
    );
  });

  it('updates editable fields and schedule timestamps', async () => {
    const { bot } = await seed();
    const routine = await repos.routines.create({
      botId: bot.id,
      name: 'Daily',
      instruction: 'Summarize',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    const when = '2026-10-20T09:00:00.000Z';
    const updated = await repos.routines.update(routine.id, {
      enabled: false,
      trigger: { type: 'cron', cron: '0 10 * * *' },
      nextRunAt: when,
    });
    expect(updated).toMatchObject({ enabled: false, trigger: { type: 'cron', cron: '0 10 * * *' }, nextRunAt: when, name: 'Daily' });
    expect(await repos.routines.remove(routine.id)).toBe(true);
  });
});

describe('devices', () => {
  it('stores devices without exposing the token hash', async () => {
    const device = await repos.devices.create({
      name: 'Phone',
      role: 'approver',
      publicKey: 'pk-1',
      tokenHash: 'hash-1',
    });
    expect(device).not.toHaveProperty('tokenHash');
    expect(device).toMatchObject({ name: 'Phone', role: 'approver', publicKey: 'pk-1' });

    const found = await repos.devices.findByTokenHash('hash-1');
    expect(found?.id).toBe(device.id);
    expect(await repos.devices.findByTokenHash('nope')).toBeUndefined();

    const seen = await repos.devices.touch(device.id);
    expect(seen?.lastSeenAt).toBeDefined();
    expect((await repos.devices.list()).map((d) => d.id)).toEqual([device.id]);
    expect(await repos.devices.remove(device.id)).toBe(true);
  });

  it('rejects duplicate token hashes', async () => {
    await repos.devices.create({ name: 'A', role: 'full', publicKey: 'pk', tokenHash: 'same' });
    await expect(
      repos.devices.create({ name: 'B', role: 'full', publicKey: 'pk', tokenHash: 'same' }),
    ).rejects.toThrow();
  });
});

describe('events', () => {
  it('appends and lists events in order with filters', async () => {
    const { bot, thread, run } = await seed();
    const started: CanonicalEvent = {
      id: 'evt-1',
      at: '2026-10-19T12:00:00.000Z',
      threadId: thread.id,
      runId: run.id,
      type: 'run.started',
      botId: bot.id,
      engine: 'mock',
    };
    const delta: CanonicalEvent = {
      id: 'evt-2',
      at: '2026-10-19T12:00:01.000Z',
      threadId: thread.id,
      runId: run.id,
      type: 'message.delta',
      messageId: 'm1',
      delta: 'Hi',
    };
    const completed: CanonicalEvent = {
      id: 'evt-3',
      at: '2026-10-19T12:00:02.000Z',
      threadId: thread.id,
      type: 'run.completed',
    };

    expect(await repos.events.append(started)).toEqual(started);
    await repos.events.append(delta);
    await repos.events.append(completed);

    expect(await repos.events.list({ threadId: thread.id })).toEqual([started, delta, completed]);
    expect(await repos.events.list({ threadId: thread.id, after: started.at })).toEqual([delta, completed]);
    expect(await repos.events.list({ threadId: thread.id, limit: 1 })).toEqual([started]);
    expect(await repos.events.list({ threadId: 'other-thread' })).toEqual([]);
  });

  it('rejects events that do not match the protocol', async () => {
    const { thread } = await seed();
    await expect(
      repos.events.append({ id: 'bad', at: 'nope', threadId: thread.id, type: 'run.completed' } as CanonicalEvent),
    ).rejects.toThrow();
  });
});

describe('cascade on bot delete', () => {
  it('removes every bot-owned row and keeps global skills', async () => {
    const { bot, thread, run } = await seed();
    await repos.messages.create({ threadId: thread.id, role: 'user', content: 'hi' });
    await repos.approvals.create({
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      kind: 'shell',
      tool: 'bash',
      summary: 'ls',
      args: {},
    });
    await repos.memories.create(bot.id, { kind: 'fact', content: 'x', sourceRunId: run.id });
    await repos.policies.create(bot.id, { tool: 'bash', effect: 'deny' });
    await repos.routines.create({
      botId: bot.id,
      name: 'r',
      instruction: 'i',
      trigger: { type: 'webhook', secret: 'cascade-secret' },
    });
    await repos.skills.create({ name: 'owned', description: 'd', body: 'b', botId: bot.id });
    const global = await repos.skills.create({ name: 'global', description: 'd', body: 'b' });
    await repos.events.append({
      id: 'evt-cascade',
      at: '2026-10-19T12:00:00.000Z',
      threadId: thread.id,
      type: 'run.completed',
    });

    expect(await repos.bots.remove(bot.id)).toBe(true);

    expect(await repos.threads.listByBot(bot.id)).toEqual([]);
    expect(await repos.messages.listByThread(thread.id)).toEqual([]);
    expect(await repos.runs.listByThread(thread.id)).toEqual([]);
    expect(await repos.approvals.list()).toEqual([]);
    expect(await repos.memories.listByBot(bot.id)).toEqual([]);
    expect(await repos.policies.listByBot(bot.id)).toEqual([]);
    expect(await repos.routines.list({ botId: bot.id })).toEqual([]);
    expect(await repos.routines.findByWebhookSecret('cascade-secret')).toBeUndefined();
    expect(await repos.events.list({ threadId: thread.id })).toEqual([]);
    expect((await repos.skills.list()).map((s) => s.id)).toEqual([global.id]);
  });
});
