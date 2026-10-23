import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@brot/ui';
import type { BackupEntry, BackupStatus } from '../data/client';
import { formatBytes, formatRelativeTime } from '../format';
import { t } from '../i18n';
import {
  BACKUP_INTERVAL_MAX,
  BACKUP_INTERVAL_MIN,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  intervalHoursProblem,
  keepProblem,
} from '../backups';
import { useClient } from './client';

export interface BackupForm {
  enabled: boolean;
  /** Raw input strings so invalid values can be typed and shown before saving. */
  intervalHours: string;
  keep: string;
}

export interface BackupsSectionProps {
  /** Status to render before the client load resolves, e.g. in an SSR render. */
  initialStatus?: BackupStatus;
  /** Form values to render before the client load resolves, e.g. in an SSR render of validation. */
  initialForm?: Partial<BackupForm>;
  /** A just-created backup to show inline, for SSR previews and tests. */
  initialRunResult?: BackupEntry;
  /** Starts showing an error, for SSR previews and tests. */
  initialError?: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Backups: scheduler settings, run-now and the recent backup folders. */
export function BackupsSection({ initialStatus, initialForm, initialRunResult, initialError }: BackupsSectionProps): ReactElement {
  const client = useClient();
  const [status, setStatus] = useState<BackupStatus | null>(initialStatus ?? null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [form, setForm] = useState<BackupForm>({
    enabled: initialForm?.enabled ?? initialStatus?.settings.enabled ?? false,
    intervalHours: initialForm?.intervalHours ?? String(initialStatus?.settings.intervalHours ?? 24),
    keep: initialForm?.keep ?? String(initialStatus?.settings.keep ?? 5),
  });
  const [busy, setBusy] = useState<'save' | 'run' | 'refresh' | null>(null);
  const [saved, setSaved] = useState(false);
  const [runResult, setRunResult] = useState<BackupEntry | null>(initialRunResult ?? null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await client.getBackups();
      setStatus(current);
      setForm({ enabled: current.settings.enabled, intervalHours: String(current.settings.intervalHours), keep: String(current.settings.keep) });
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setStatus((currentValue) => currentValue ?? { settings: { enabled: false, intervalHours: 24, keep: 5 }, backups: [] });
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const intervalBad = intervalHoursProblem(form.intervalHours);
  const keepBad = keepProblem(form.keep);
  const invalid = intervalBad || keepBad;

  const save = async () => {
    if (busy !== null || invalid) return;
    setBusy('save');
    setSaved(false);
    setActionError(null);
    try {
      const savedSettings = await client.updateBackupSettings({
        enabled: form.enabled,
        intervalHours: Number(form.intervalHours),
        keep: Number(form.keep),
      });
      setStatus((current) => (current === null ? current : { ...current, settings: savedSettings }));
      setSaved(true);
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (busy !== null) return;
    setBusy('run');
    setRunResult(null);
    setActionError(null);
    try {
      const entry = await client.runBackupNow();
      setRunResult(entry);
      const current = await client.getBackups();
      setStatus(current);
      setForm({ enabled: current.settings.enabled, intervalHours: String(current.settings.intervalHours), keep: String(current.settings.keep) });
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    if (busy !== null) return;
    setBusy('refresh');
    await load();
    setBusy(null);
  };

  const settings = status?.settings;
  return (
    <div className="flex flex-col gap-3">
      {status === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} shape="block" height={32} />
          ))}
        </div>
      ) : (
        <>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-surface-2">
            <input
              type="checkbox"
              className="room-check mt-1"
              checked={form.enabled}
              disabled={busy !== null}
              onChange={(event) => {
                setForm((current) => ({ ...current, enabled: event.target.checked }));
                setSaved(false);
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('settings.backupEnabled')}</span>
              <span className="text-xs text-ink-2">{t('settings.backupEnabledHint')}</span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={t('settings.backupInterval')}
              hint={t('settings.backupIntervalHint')}
              type="number"
              inputMode="numeric"
              min={BACKUP_INTERVAL_MIN}
              max={BACKUP_INTERVAL_MAX}
              value={form.intervalHours}
              error={intervalBad ? t('settings.backupIntervalError') : undefined}
              disabled={busy !== null}
              onChange={(event) => {
                setForm((current) => ({ ...current, intervalHours: event.target.value }));
                setSaved(false);
              }}
            />
            <Input
              label={t('settings.backupKeep')}
              hint={t('settings.backupKeepHint')}
              type="number"
              inputMode="numeric"
              min={BACKUP_KEEP_MIN}
              max={BACKUP_KEEP_MAX}
              value={form.keep}
              error={keepBad ? t('settings.backupKeepError') : undefined}
              disabled={busy !== null}
              onChange={(event) => {
                setForm((current) => ({ ...current, keep: event.target.value }));
                setSaved(false);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" disabled={busy !== null || invalid} onClick={() => void save()}>
              {t('settings.backupSave')}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => void run()}>
              {busy === 'run' ? t('settings.backupRunning') : t('settings.backupRunNow')}
            </Button>
          </div>
          {saved ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {t('settings.backupSaved')}
            </p>
          ) : null}
          {runResult !== null ? (
            <p role="status" className="m-0 text-sm text-ink-2">
              {t('settings.backupRunSuccess', { name: runResult.name, size: formatBytes(runResult.sizeBytes) })}
            </p>
          ) : null}
          {actionError !== null ? (
            <p role="alert" className="m-0 text-sm text-attention-text">
              {actionError}
            </p>
          ) : null}
          {settings !== undefined ? (
            <div className="flex flex-col gap-1 text-sm text-ink-2">
              <p className="m-0">
                {settings.lastRunAt === undefined
                  ? t('settings.backupNever')
                  : t('settings.backupLastRun', { name: settings.lastBackupName ?? '', time: formatRelativeTime(settings.lastRunAt) })}
              </p>
              {settings.enabled && status?.nextRunAt !== undefined ? (
                <p className="m-0">{t('settings.backupNextRun', { time: formatRelativeTime(status.nextRunAt) })}</p>
              ) : null}
              {settings.lastError !== undefined ? (
                <p role="alert" className="m-0 text-attention-text">
                  {t('settings.backupLastError', { error: settings.lastError })}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <span className="text-sm font-medium">{t('settings.backupRecent')}</span>
            <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void refresh()}>
              {t('settings.backupRefresh')}
            </Button>
          </div>
          {error !== null ? (
            <p role="alert" className="m-0 text-sm text-attention-text">
              {error}
            </p>
          ) : null}
          {status !== null && status.backups.length === 0 ? (
            <EmptyState title={t('settings.backupEmptyTitle')} description={t('settings.backupEmptyBody')} />
          ) : status !== null ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {status.backups.map((entry) => (
                <li key={entry.name}>
                  <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</code>
                    {entry.includesSecrets ? <Badge>{t('settings.backupIncludesSecrets')}</Badge> : null}
                    <span className="text-xs text-ink-3 tabular-nums">{formatBytes(entry.sizeBytes)}</span>
                    <time className="text-xs text-ink-3 tabular-nums" dateTime={entry.createdAt}>
                      {formatRelativeTime(entry.createdAt)}
                    </time>
                  </Card>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {status === null && error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
