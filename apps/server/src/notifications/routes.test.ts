import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Notification, Thread } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;
let bot: Bot;
let thread: Thread;

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
  bot = await ctx.services.repos.bots.create({ name: 'Ada', job: 'Researcher', engine: 'mock' });
  thread = await ctx.services.repos.threads.create(bot.id, { title: 'Chat' });
});

afterEach(async () => {
  await ctx.close();
});

async function seed(
  overrides: { botId?: string; threadId?: string; kind?: 'approval' | 'finished' | 'failed'; createdAt?: string } = {},
): Promise<Notification> {
  return ctx.services.repos.notifications.create({
    botId: overrides.botId ?? bot.id,
    threadId: overrides.threadId ?? thread.id,
    kind: overrides.kind ?? 'finished',
    title: '"Ada" finished',
    body: 'Done.',
    ...(overrides.createdAt === undefined ? {} : { createdAt: overrides.createdAt }),
  });
}

describe('GET /api/notifications', () => {
  it('lists notifications newest first', async () => {
    const first = await seed({ createdAt: '2026-10-20T10:00:00.000Z' });
    const second = await seed({ createdAt: '2026-10-20T11:00:00.000Z', kind: 'approval' });

    const res = await call(ctx.app, 'GET', '/api/notifications');
    expect(res.status).toBe(200);
    const listed = (await res.json()) as Notification[];
    expect(listed.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(listed[0]).toMatchObject({ botId: bot.id, threadId: thread.id });
    expect(listed[0]?.readAt).toBeUndefined();
  });

  it('filters by unread and bot, and limits the page', async () => {
    const other = await ctx.services.repos.bots.create({ name: 'Bo', job: 'x', engine: 'mock' });
    const otherThread = await ctx.services.repos.threads.create(other.id);
    const read = await seed({ createdAt: '2026-10-20T10:00:00.000Z' });
    const unread = await seed({ createdAt: '2026-10-20T11:00:00.000Z' });
    const foreign = await seed({ botId: other.id, threadId: otherThread.id, createdAt: '2026-10-20T12:00:00.000Z' });
    await ctx.services.repos.notifications.markRead([read.id]);

    const unreadOnly = (await (await call(ctx.app, 'GET', '/api/notifications?unread=true')).json()) as Notification[];
    expect(unreadOnly.map((item) => item.id)).toEqual([foreign.id, unread.id]);

    const forBot = (await (await call(ctx.app, 'GET', `/api/notifications?botId=${other.id}`)).json()) as Notification[];
    expect(forBot.map((item) => item.id)).toEqual([foreign.id]);

    const limited = (await (await call(ctx.app, 'GET', '/api/notifications?limit=1')).json()) as Notification[];
    expect(limited).toHaveLength(1);
  });

  it('rejects an invalid unread flag or limit', async () => {
    expect((await call(ctx.app, 'GET', '/api/notifications?unread=maybe')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/notifications?limit=0')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/notifications?limit=abc')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/notifications?limit=999')).status).toBe(200);
  });

  it('requires device auth from a remote caller', async () => {
    const res = await ctx.remote.request('/api/notifications');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('counts unread notifications', async () => {
    await seed();
    const read = await seed();
    await ctx.services.repos.notifications.markRead([read.id]);

    const res = await call(ctx.app, 'GET', '/api/notifications/unread-count');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1 });
  });
});

describe('POST /api/notifications/read', () => {
  it('marks every unread notification with an empty body', async () => {
    await seed();
    await seed();
    const res = await call(ctx.app, 'POST', '/api/notifications/read', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2 });
    expect(await ctx.services.repos.notifications.countUnread()).toBe(0);
  });

  it('marks only the given ids and reports how many changed', async () => {
    const first = await seed({ createdAt: '2026-10-20T10:00:00.000Z' });
    const second = await seed({ createdAt: '2026-10-20T11:00:00.000Z' });

    const res = await call(ctx.app, 'POST', '/api/notifications/read', { ids: [first.id] });
    expect(await res.json()).toEqual({ updated: 1 });
    const listed = (await (await call(ctx.app, 'GET', '/api/notifications')).json()) as Notification[];
    expect(listed.find((item) => item.id === first.id)?.readAt).toEqual(expect.any(String));
    expect(listed.find((item) => item.id === second.id)?.readAt).toBeUndefined();

    expect(await (await call(ctx.app, 'POST', '/api/notifications/read', { ids: [first.id] })).json()).toEqual({
      updated: 0,
    });
  });

  it('rejects an invalid body and a non-JSON write', async () => {
    expect((await call(ctx.app, 'POST', '/api/notifications/read', { ids: 'nope' })).status).toBe(400);
    const noContentType = await ctx.app.request('/api/notifications/read', { method: 'POST' });
    expect(noContentType.status).toBe(415);
  });
});

describe('DELETE /api/notifications/:id', () => {
  it('deletes one notification and reports a missing one', async () => {
    const notification = await seed();
    expect((await call(ctx.app, 'DELETE', `/api/notifications/${notification.id}`)).status).toBe(204);
    expect(await ctx.services.repos.notifications.list()).toEqual([]);
    expect((await call(ctx.app, 'DELETE', `/api/notifications/${notification.id}`)).status).toBe(404);
  });
});
