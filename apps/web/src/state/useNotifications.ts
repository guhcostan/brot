import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notification } from '@brot/protocol';
import type { BrotClient } from '../data/client';
import { canShowInBackground, showDesktopNotification } from '../desktopNotifications';

/** How often the badge refreshes while the app is being looked at (and, with permission, while hidden). */
export const NOTIFICATION_POLL_MS = 20_000;
const UNREAD_LIST_LIMIT = 20;

export interface NotificationInbox {
  unread: number;
  /** Re-reads the unread count, the unread records, and shows desktop banners for newly arrived ones. */
  refresh: () => Promise<void>;
}

/**
 * The unread notification badge and the desktop banners. Polls the server, refreshes on window focus,
 * and shows one browser notification per new unread record only when the window is in the background.
 * A record is announced once per session; the first load only marks what is already there as seen.
 */
export function useNotifications(client: BrotClient, onOpen: (notification: Notification) => void): NotificationInbox {
  const [unread, setUnread] = useState(0);
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  const opener = useRef(onOpen);
  opener.current = onOpen;

  const refresh = useCallback(async () => {
    try {
      const [count, list] = await Promise.all([
        client.unreadNotificationCount(),
        client.listNotifications({ unread: true, limit: UNREAD_LIST_LIMIT }),
      ]);
      setUnread(count);
      const fresh = list.filter((notification) => !seen.current.has(notification.id));
      for (const notification of list) seen.current.add(notification.id);
      if (!primed.current) {
        primed.current = true;
        return;
      }
      if (fresh.length === 0 || !canShowInBackground()) return;
      for (const notification of fresh) {
        showDesktopNotification({
          title: notification.title,
          body: notification.body,
          tag: notification.id,
          onClick: () => opener.current(notification),
        });
      }
    } catch (error) {
      // A background poll failing should not disturb the app; the next tick retries.
      console.warn('Notifications did not refresh', error);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const tick = () => {
      if (typeof document === 'undefined') return;
      // Poll a hidden tab only when the person opted into desktop notifications; otherwise wait for focus.
      if (document.visibilityState === 'visible' || canShowInBackground()) void refresh();
    };
    const timer = setInterval(tick, NOTIFICATION_POLL_MS);
    const focus = () => {
      void refresh();
    };
    if (typeof window !== 'undefined') window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('focus', focus);
    };
  }, [refresh]);

  return { unread, refresh };
}
