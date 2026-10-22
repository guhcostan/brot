import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_BODY_MAX,
  canShowInBackground,
  desktopNotificationState,
  desktopNotificationsSupported,
  notificationPreview,
  requestDesktopNotifications,
  showDesktopNotification,
} from './desktopNotifications';

describe('desktop notifications without a browser', () => {
  it('reports the API as unsupported instead of touching window or document', async () => {
    expect(desktopNotificationsSupported()).toBe(false);
    expect(desktopNotificationState()).toBe('unsupported');
    expect(canShowInBackground()).toBe(false);
    expect(showDesktopNotification({ title: 'Hi', body: 'There' })).toBe(false);
    await expect(requestDesktopNotifications()).resolves.toBe('unsupported');
  });
});

describe('notificationPreview', () => {
  it('collapses whitespace and trims to the banner budget', () => {
    expect(notificationPreview('  two\n\nlines  ')).toBe('two lines');
    const long = notificationPreview('x'.repeat(NOTIFICATION_BODY_MAX + 40));
    expect(long).toHaveLength(NOTIFICATION_BODY_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    const emoji = '😀'.repeat(NOTIFICATION_BODY_MAX);
    const preview = notificationPreview(emoji);
    expect([...preview].every((character) => character === '😀' || character === '…')).toBe(true);
  });
});
