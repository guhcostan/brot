import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Bot, Notification, NotificationKind } from '@brot/protocol';
import { Badge, BotAvatar, Button, EmptyState, Skeleton, cx } from '@brot/ui';
import { useClient } from './client';
import { avatarOf, formatRelativeTime } from '../format';
import { t, type TranslationKey } from '../i18n';
import { Bell, Trash } from './icons';
import { PaneHeader } from './ThreadView';

export interface NotificationsViewProps {
  bots: Bot[];
  onOpenBots: () => void;
  /** Opens the conversation a notification points at (the caller marks it read first). */
  onOpenNotification: (notification: Notification) => void;
  /** Tells the app to refresh the unread badge after a mutation. */
  onInboxChanged: () => void;
  /** Notifications to render before the client load resolves, e.g. in an SSR render. */
  initialNotifications?: Notification[];
}

const KIND_KEY: Record<NotificationKind, TranslationKey> = {
  approval: 'notifications.kind.approval',
  question: 'notifications.kind.question',
  finished: 'notifications.kind.finished',
  failed: 'notifications.kind.failed',
  routine_failed: 'notifications.kind.routine_failed',
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A kind badge; failures use the attention tone, the rest stay neutral (DESIGN.md section 4). */
export function NotificationKindBadge({ kind }: { kind: NotificationKind }): ReactElement {
  return <Badge tone={kind === 'failed' || kind === 'routine_failed' ? 'attention' : 'neutral'}>{t(KIND_KEY[kind])}</Badge>;
}

/**
 * The notification inbox (PRODUCT.md E2): approvals, failures and finished runs, newest first.
 * Clicking one marks it read and opens its conversation; the list owns its data and refreshes after
 * every mutation.
 */
export function NotificationsView({
  bots,
  onOpenBots,
  onOpenNotification,
  onInboxChanged,
  initialNotifications,
}: NotificationsViewProps): ReactElement {
  const client = useClient();
  const [notifications, setNotifications] = useState<Notification[] | null>(initialNotifications ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotifications(await client.listNotifications());
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setNotifications((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // A notification can arrive while the pane is open; re-read when the window comes back.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      void load();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load]);

  const botsById = Object.fromEntries(bots.map((bot) => [bot.id, bot]));
  const unread = (notifications ?? []).filter((notification) => notification.readAt === undefined).length;

  const markAll = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await client.markNotificationsRead();
      await load();
      onInboxChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const open = (notification: Notification) => {
    if (notification.readAt === undefined) {
      // Update the row at once, then tell the server and the badge; the click opens the thread either way.
      setNotifications((current) =>
        (current ?? []).map((entry) => (entry.id === notification.id ? { ...entry, readAt: new Date().toISOString() } : entry)),
      );
      void client
        .markNotificationsRead([notification.id])
        .then(() => onInboxChanged())
        .catch(() => onInboxChanged());
    }
    onOpenNotification(notification);
  };

  const remove = async (notification: Notification) => {
    setError(null);
    try {
      await client.deleteNotification(notification.id);
      setNotifications((current) => (current ?? []).filter((entry) => entry.id !== notification.id));
      onInboxChanged();
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots}>
        <span className="flex size-7 flex-none items-center justify-center text-ink">
          <Bell />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{t('notifications.title')}</h1>
          <p className="m-0 truncate text-sm text-ink-2">
            {notifications === null ? t('app.loading') : t('notifications.summary', { unread: String(unread), count: String(notifications.length) })}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
          {t('notifications.refresh')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void markAll()} disabled={busy || unread === 0}>
          {t('notifications.markAll')}
        </Button>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2 px-4 py-6 md:px-6">
          {error ? (
            <p role="alert" className="m-0 rounded-md border border-attention bg-surface px-3 py-2 text-sm text-attention-text">
              {error}
            </p>
          ) : null}

          {notifications === null ? (
            <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} height={76} shape="block" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <EmptyState icon={<Bell size={28} />} title={t('notifications.emptyTitle')} description={t('notifications.emptyBody')} />
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {notifications.map((notification) => {
                const bot = botsById[notification.botId];
                const avatar = avatarOf(bot ?? { id: notification.botId });
                const unreadRow = notification.readAt === undefined;
                return (
                  <li key={notification.id}>
                    <div
                      data-unread={unreadRow ? 'true' : undefined}
                      className={cx(
                        'flex items-start gap-2 rounded-lg border p-2 transition-colors duration-[var(--dur-fast)]',
                        unreadRow ? 'border-line bg-surface-2' : 'border-line bg-surface',
                      )}
                    >
                      <span
                        className={cx('mt-2.5 size-2 flex-none rounded-full', unreadRow ? 'bg-ink' : 'bg-transparent')}
                        {...(unreadRow ? { 'aria-label': t('notifications.unread'), role: 'img' } : { 'aria-hidden': true })}
                      />
                      <button
                        type="button"
                        onClick={() => open(notification)}
                        className="flex min-w-0 flex-1 items-start gap-3 rounded-md px-1 py-1 text-left hover:bg-surface-2"
                      >
                        <span className="flex flex-none pt-0.5" data-avatar-zone>
                          <BotAvatar shape={avatar.shape} color={avatar.color} size={28} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <NotificationKindBadge kind={notification.kind} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{notification.title}</span>
                          </span>
                          <span className="line-clamp-2 text-sm text-ink-2">{notification.body}</span>
                          <span className="truncate text-xs text-ink-3">
                            {bot?.name ?? t('team.unknownBot')} · {formatRelativeTime(notification.createdAt)}
                          </span>
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(notification)}
                        aria-label={t('notifications.delete')}
                        title={t('notifications.delete')}
                        className="flex-none text-ink-3"
                      >
                        <Trash size={15} />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
