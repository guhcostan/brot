import { describe, expect, it } from 'vitest';
import { MarkNotificationsRead, Notification, NotificationKind, type Notification as NotificationValue } from './notifications';

const at = '2026-10-22T12:00:00.000Z';

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

const notification = {
  id: 'ntf_1',
  botId: 'bot_1',
  threadId: 't1',
  kind: 'approval' as const,
  title: '"Ada" needs your approval',
  body: 'Send the invoice',
  createdAt: at,
};

describe('Notification', () => {
  it('round-trips a notification through JSON, with and without readAt', () => {
    expect(roundTrip(Notification, notification)).toEqual(notification);
    const read: NotificationValue = { ...notification, kind: 'finished', readAt: at };
    expect(roundTrip(Notification, read)).toEqual(read);
  });

  it('accepts every kind', () => {
    expect(NotificationKind.options).toEqual(['approval', 'question', 'finished', 'failed', 'routine_failed']);
    for (const kind of NotificationKind.options) {
      expect(Notification.parse({ ...notification, kind }).kind).toBe(kind);
    }
    expect(() => Notification.parse({ ...notification, kind: 'reminder' })).toThrow();
  });

  it('rejects an empty title and a missing field', () => {
    expect(() => Notification.parse({ ...notification, title: '' })).toThrow();
    expect(() => Notification.parse({ ...notification, botId: undefined })).toThrow();
    expect(() => Notification.parse({ ...notification, readAt: 'yesterday' })).toThrow();
  });
});

describe('MarkNotificationsRead', () => {
  it('takes an optional ids list; absent marks everything', () => {
    expect(MarkNotificationsRead.parse({})).toEqual({});
    expect(MarkNotificationsRead.parse({ ids: ['n1', 'n2'] })).toEqual({ ids: ['n1', 'n2'] });
    expect(() => MarkNotificationsRead.parse({ ids: [''] })).toThrow();
    expect(() => MarkNotificationsRead.parse({ ids: 'n1' })).toThrow();
  });
});
