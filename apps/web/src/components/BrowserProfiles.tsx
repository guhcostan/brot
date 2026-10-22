import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Button, Input, Skeleton } from '@brot/ui';
import type { BrowserProfile, CreateBrowserProfile, UpdateBrowserProfile } from '../data/client';
import { getLocale, t } from '../i18n';
import { useClient } from './client';
import { ConfirmDialog, Dialog } from './Dialog';
import { Pencil, Plus, Trash } from './icons';
import { useTeam } from './team';

export interface BrowserProfilesProps {
  /** Profiles to render before the client load resolves, e.g. in an SSR render. */
  initialProfiles?: BrowserProfile[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const createdFormat = new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Shared host-browser profiles: one set of saved logins per profile, reused by every bot bound to it.
 * Deleting one closes its browser, deletes the saved logins, and sends its bots back to their own profile.
 */
export function BrowserProfiles({ initialProfiles }: BrowserProfilesProps): ReactElement {
  const client = useClient();
  const { bots } = useTeam();
  const [profiles, setProfiles] = useState<BrowserProfile[] | null>(initialProfiles ?? null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ profile?: BrowserProfile } | null>(null);
  const [deleting, setDeleting] = useState<BrowserProfile | null>(null);

  const load = useCallback(async () => {
    try {
      setProfiles(await client.listBrowserProfiles());
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setProfiles((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (input: CreateBrowserProfile) => {
    await client.createBrowserProfile(input);
    await load();
  };

  const rename = async (profileId: string, input: UpdateBrowserProfile) => {
    await client.updateBrowserProfile(profileId, input);
    await load();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
          <Plus size={14} />
          {t('settings.newBrowserProfile')}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {profiles === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} height={62} shape="block" />
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('settings.browserProfilesEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-lg border border-line p-0">
          {profiles.map((profile) => {
            const count = Object.values(bots).filter((bot) => bot.browserProfileId === profile.id).length;
            return (
              <li key={profile.id} className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 last:border-b-0">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{profile.name}</span>
                  <span className="truncate text-xs text-ink-2">
                    {count === 0 ? t('settings.browserProfileUnused') : t('settings.browserProfileBotCount', { count: String(count) })} ·{' '}
                    {t('settings.browserProfileCreated', { date: createdFormat.format(new Date(profile.createdAt)) })}
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setDialog({ profile })} aria-label={t('settings.browserProfileRename', { name: profile.name })} title={t('settings.browserProfileRename', { name: profile.name })}>
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleting(profile)}
                  aria-label={t('settings.browserProfileDeleteNamed', { name: profile.name })}
                  title={t('settings.browserProfileDeleteNamed', { name: profile.name })}
                  className="text-ink-3"
                >
                  <Trash size={15} />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={dialog !== null} title={t(dialog?.profile ? 'settings.browserProfileDialogEdit' : 'settings.browserProfileDialogNew')} onClose={() => setDialog(null)}>
        {dialog !== null ? (
          <ProfileForm
            profile={dialog.profile}
            onClose={() => setDialog(null)}
            onCreate={create}
            onRename={rename}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={t('settings.browserProfileDeleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings.browserProfileDeleteBody')}
        confirmLabel={t('settings.browserProfileDelete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await client.deleteBrowserProfile(deleting.id);
            setDeleting(null);
            await load();
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function ProfileForm({
  profile,
  onClose,
  onCreate,
  onRename,
}: {
  profile?: BrowserProfile | undefined;
  onClose: () => void;
  onCreate: (input: CreateBrowserProfile) => Promise<unknown>;
  onRename: (profileId: string, input: UpdateBrowserProfile) => Promise<unknown>;
}): ReactElement {
  const [name, setName] = useState(profile?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const valid = name.trim().length > 0;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (profile) await onRename(profile.id, { name: name.trim() });
      else await onCreate({ name: name.trim() });
      onClose();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-4 pb-5" noValidate>
      <Input
        label={t('settings.browserProfileName')}
        placeholder={t('settings.browserProfileNamePlaceholder')}
        maxLength={60}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={tried && !valid ? t('settings.browserProfileNameRequired') : undefined}
        autoFocus
      />
      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('dialog.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t(profile ? 'settings.browserProfileSave' : 'settings.browserProfileCreate')}
        </Button>
      </div>
    </form>
  );
}
