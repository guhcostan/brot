import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CreateSavedLogin, SavedLogin, UpdateSavedLogin } from '@brot/protocol';
import { Badge, Button, Skeleton } from '@brot/ui';
import { t } from '../i18n';
import { useClient } from './client';
import { ConfirmDialog } from './Dialog';
import { SavedLoginDialog } from './SavedLoginDialog';
import { Pencil, Plus, Trash } from './icons';

export interface SavedLoginsProps {
  /** Logins to render before the client load resolves, e.g. in an SSR render. */
  initialLogins?: SavedLogin[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Saved logins for the host browser. The API only ever returns names and metadata, so this section can
 * never show a credential; editing keeps the stored values unless new ones are typed.
 */
export function SavedLogins({ initialLogins }: SavedLoginsProps): ReactElement {
  const client = useClient();
  const [logins, setLogins] = useState<SavedLogin[] | null>(initialLogins ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ login?: SavedLogin } | null>(null);
  const [deleting, setDeleting] = useState<SavedLogin | null>(null);

  const load = useCallback(async () => {
    try {
      setLogins(await client.listSavedLogins());
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setLogins((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (input: CreateSavedLogin) => {
    await client.createSavedLogin(input);
    await load();
  };

  const update = async (loginId: string, patch: UpdateSavedLogin) => {
    await client.updateSavedLogin(loginId, patch);
    await load();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
          <Plus size={14} />
          {t('settings.savedLoginNew')}
        </Button>
      </div>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {logins === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} height={58} shape="block" />
          ))}
        </div>
      ) : logins.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('settings.savedLoginsEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-line p-0">
          {logins.map((login) => (
            <li key={login.id} className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 last:border-b-0">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{login.name}</span>
                  {login.hasTotp ? <Badge>{t('settings.savedLoginTotpBadge')}</Badge> : null}
                  {login.label !== undefined ? <span className="truncate text-xs text-ink-3">{login.label}</span> : null}
                </span>
                <span className="truncate font-mono text-xs text-ink-2">{login.host}</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDialog({ login })}
                aria-label={t('settings.savedLoginEditNamed', { name: login.name })}
                title={t('settings.savedLoginEditNamed', { name: login.name })}
              >
                <Pencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(login)}
                aria-label={t('settings.savedLoginDeleteNamed', { name: login.name })}
                title={t('settings.savedLoginDeleteNamed', { name: login.name })}
                className="text-ink-3"
              >
                <Trash size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <SavedLoginDialog
        open={dialog !== null}
        login={dialog?.login}
        onClose={() => setDialog(null)}
        onCreate={create}
        onUpdate={update}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('settings.savedLoginDeleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings.savedLoginDeleteBody')}
        confirmLabel={t('settings.savedLoginDelete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await client.deleteSavedLogin(deleting.id);
            setDeleting(null);
            await load();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
