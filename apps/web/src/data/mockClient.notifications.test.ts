import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock notifications', () => {
  it('seeds an inbox with unread and read entries, newest first', async () => {
    const client = createMockClient();
    const list = await client.listNotifications();

    expect(list.map((notification) => notification.id)).toEqual([
      'ntf_tuca_approval',
      'ntf_onca_failed',
      'ntf_capy_finished',
      'ntf_sol_routine',
    ]);
    expect(list.find((notification) => notification.id === 'ntf_capy_finished')?.readAt).toBeDefined();
    expect(await client.unreadNotificationCount()).toBe(3);
  });

  it('filters by unread, bot and limit', async () => {
    const client = createMockClient();

    expect((await client.listNotifications({ unread: true })).map((notification) => notification.id)).toEqual([
      'ntf_tuca_approval',
      'ntf_onca_failed',
      'ntf_sol_routine',
    ]);
    expect((await client.listNotifications({ botId: 'bot_capy' })).map((notification) => notification.kind)).toEqual(['finished']);
    expect(await client.listNotifications({ limit: 2 })).toHaveLength(2);
    expect(await client.listNotifications({ botId: 'bot_mico' })).toEqual([]);
  });

  it('marks specific ids read, then every unread one', async () => {
    const client = createMockClient();

    await expect(client.markNotificationsRead(['ntf_onca_failed'])).resolves.toBe(1);
    expect(await client.unreadNotificationCount()).toBe(2);
    expect((await client.listNotifications()).find((notification) => notification.id === 'ntf_onca_failed')?.readAt).toBeDefined();

    await expect(client.markNotificationsRead()).resolves.toBe(2);
    expect(await client.unreadNotificationCount()).toBe(0);
    await expect(client.markNotificationsRead()).resolves.toBe(0);
    await expect(client.markNotificationsRead([])).resolves.toBe(0);
  });

  it('deletes a notification and refuses an unknown one', async () => {
    const client = createMockClient();

    await client.deleteNotification('ntf_tuca_approval');
    expect((await client.listNotifications()).some((notification) => notification.id === 'ntf_tuca_approval')).toBe(false);
    await expect(client.deleteNotification('nope')).rejects.toThrow();
  });

  it('drops a deleted bot notifications', async () => {
    const client = createMockClient();
    await client.deleteBot('bot_tuca');

    expect((await client.listNotifications()).some((notification) => notification.botId === 'bot_tuca')).toBe(false);
    expect(await client.unreadNotificationCount()).toBe(2);
  });
});
