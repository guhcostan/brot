import type { Notification } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, parseUnreadCount, parseUpdatedCount, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const notification: Notification = {
  id: 'ntf_1',
  botId: 'bot_1',
  threadId: 'thr_1',
  kind: 'approval',
  title: 'Capy needs your OK',
  body: 'Send the follow-up.',
  createdAt: at,
};

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('notification routes', () => {
  it('lists notifications with the unread, bot and limit filters', async () => {
    const { fetch, calls } = fakeFetch(() => json([notification]));
    const client = createHttpClient({ fetch });

    await expect(client.listNotifications({ unread: true, botId: 'bot_1', limit: 20 })).resolves.toEqual([notification]);
    expect(calls[0]?.path).toBe('/api/notifications');
    expect(calls[0]?.search).toBe('?unread=true&botId=bot_1&limit=20');

    await client.listNotifications();
    expect(calls[1]?.search).toBe('');
  });

  it('reads the unread count', async () => {
    const { fetch, calls } = fakeFetch(() => json({ count: 4 }));
    const client = createHttpClient({ fetch });

    await expect(client.unreadNotificationCount()).resolves.toBe(4);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/notifications/unread-count' });
  });

  it('marks specific ids read, or every unread one without ids', async () => {
    const { fetch, calls } = fakeFetch(() => json({ updated: 2 }));
    const client = createHttpClient({ fetch });

    await expect(client.markNotificationsRead(['ntf_1', 'ntf_2'])).resolves.toBe(2);
    await expect(client.markNotificationsRead()).resolves.toBe(2);

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /api/notifications/read', 'POST /api/notifications/read']);
    expect(calls[0]?.body).toEqual({ ids: ['ntf_1', 'ntf_2'] });
    expect(calls[1]?.body).toEqual({});
  });

  it('deletes one notification and accepts the 204', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch });

    await expect(client.deleteNotification('ntf_1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/notifications/ntf_1' });
  });

  it('surfaces a rejected unread filter and an unknown notification', async () => {
    const { fetch } = fakeFetch((call) =>
      call.method === 'DELETE' ? json({ error: 'Notification not found' }, 404) : json({ error: 'unread must be true or false' }, 400),
    );
    const client = createHttpClient({ fetch });

    await expect(client.listNotifications()).rejects.toThrow('400 unread must be true or false');
    await expect(client.deleteNotification('nope')).rejects.toThrow('404 Notification not found');
  });

  it('rejects responses that do not match the protocol', async () => {
    const { fetch } = fakeFetch((call) =>
      call.path === '/api/notifications'
        ? json([{ id: 'ntf_1' }])
        : call.path === '/api/notifications/unread-count'
          ? json({ count: 'many' })
          : json({ updated: 'all' }),
    );
    const client = createHttpClient({ fetch });

    await expect(client.listNotifications()).rejects.toThrow();
    await expect(client.unreadNotificationCount()).rejects.toThrow();
    await expect(client.markNotificationsRead()).rejects.toThrow();
  });
});

describe('notification parsers', () => {
  it('validate the count and updated bodies', () => {
    expect(parseUnreadCount({ count: 0 })).toBe(0);
    expect(() => parseUnreadCount(null)).toThrow();
    expect(() => parseUnreadCount({ count: 'x' })).toThrow();
    expect(parseUpdatedCount({ updated: 3 })).toBe(3);
    expect(() => parseUpdatedCount({})).toThrow();
  });
});
