import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton } from '@brot/ui';
import type { AdminAction, AdminActivity } from '../data/client';
import { formatRelativeTime } from '../format';
import { t, type TranslationKey } from '../i18n';
import { useClient } from './client';

export interface AdminActivitySectionProps {
  /** Entries to render before the client load resolves, e.g. in an SSR render. */
  initialEntries?: AdminActivity[];
}

const ACTION_KEY: Record<AdminAction, TranslationKey> = {
  created: 'settings.adminActivity.created',
  updated: 'settings.adminActivity.updated',
  deleted: 'settings.adminActivity.deleted',
  revoked: 'settings.adminActivity.revoked',
  ran: 'settings.adminActivity.ran',
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Admin activity: the read-only workspace change log, newest first. */
export function AdminActivitySection({ initialEntries }: AdminActivitySectionProps): ReactElement {
  const client = useClient();
  const [entries, setEntries] = useState<AdminActivity[] | null>(initialEntries ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    try {
      setEntries(await client.listAdminActivity({ limit: 50 }));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setEntries((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAttempt((current) => current + 1)}>
          {t('settings.adminActivityRefresh')}
        </Button>
      </div>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {entries === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} shape="block" height={64} />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState title={t('settings.adminActivityEmptyTitle')} description={t('settings.adminActivityEmptyBody')} />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card className="flex flex-col gap-1.5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={entry.action === 'deleted' || entry.action === 'revoked' ? 'attention' : 'neutral'}>
                      {t(ACTION_KEY[entry.action])}
                    </Badge>
                    <span className="flex-1" />
                    <time className="text-xs text-ink-3 tabular-nums" dateTime={entry.at}>
                      {formatRelativeTime(entry.at)}
                    </time>
                  </div>
                  <p className="m-0 text-sm">{entry.summary}</p>
                  <p className="m-0 text-xs text-ink-2">
                    {entry.actor === 'local' ? t('settings.adminActivityYou') : entry.actor}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-ink-3">{t('settings.adminActivityLatest', { count: '50' })}</p>
        </>
      )}
    </div>
  );
}
