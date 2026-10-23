import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { MemoryScope } from '@brot/protocol';
import { Badge, Button, Card, EmptyState, Skeleton } from '@brot/ui';
import type { MemoryJournalEntry } from '../data/client';
import { formatRelativeTime } from '../format';
import { t } from '../i18n';
import { MEMORY_KIND_KEY } from './memoryShared';
import { useClient } from './client';
import { ConfirmDialog, Dialog } from './Dialog';
import { Clock } from './icons';

export interface MemoryJournalDialogProps {
  open: boolean;
  scope: MemoryScope;
  /** The bot whose memory is shown; absent for workspace facts. */
  botId?: string;
  botName?: string;
  onClose: () => void;
  /** Refreshes the memory list the person is looking at after an undo. */
  onChanged: () => Promise<unknown> | unknown;
  /** Entries to render before the client load resolves, e.g. in an SSR render. */
  initialEntries?: MemoryJournalEntry[];
  /** Shows this error instead of loading, e.g. in an SSR render of the error state. */
  initialError?: string;
  /** Shows this conflict instead of loading, e.g. in an SSR render of the conflict state. */
  initialConflict?: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** History of memory changes with one-step undo, shared by a bot's Memory tab and Settings About me. */
export function MemoryJournalDialog({
  open,
  scope,
  botId,
  botName,
  onClose,
  onChanged,
  initialEntries,
  initialError,
  initialConflict,
}: MemoryJournalDialogProps): ReactElement {
  const client = useClient();
  const [entries, setEntries] = useState<MemoryJournalEntry[] | null>(initialEntries ?? null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [conflict, setConflict] = useState<string | null>(initialConflict ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<MemoryJournalEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await client.listMemoryJournal({ scope, ...(botId === undefined ? {} : { botId }), limit: 50 }));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setEntries((current) => current ?? []);
    }
  }, [botId, client, scope]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const undo = async (entry: MemoryJournalEntry) => {
    setBusyId(entry.id);
    setError(null);
    setConflict(null);
    setNotice(null);
    try {
      const result = await client.undoMemoryJournal(entry.id);
      setNotice(t(result.result === 'restored' ? 'memoryJournal.undoRestored' : 'memoryJournal.undoRemoved'));
      await onChanged();
      await load();
    } catch (cause) {
      setConflict(t('memoryJournal.conflict'));
      setError(messageOf(cause));
      await load();
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  };

  const description = scope === 'bot' ? t('memoryJournal.descriptionBot', { name: botName ?? t('team.unknownBot') }) : t('memoryJournal.descriptionWorkspace');

  return (
    <Dialog open={open} size="md" title={t('memoryJournal.title')} description={description} onClose={onClose}>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
        {notice !== null ? (
          <p role="status" className="m-0 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-sm text-ink-2">
            {notice}
          </p>
        ) : null}
        {conflict !== null ? (
          <p role="alert" className="m-0 text-sm text-attention-text">
            {conflict}
          </p>
        ) : null}
        {error !== null && conflict === null ? (
          <p role="alert" className="m-0 text-sm text-attention-text">
            {error}
          </p>
        ) : null}

        {entries === null ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} shape="block" height={72} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title={t('memoryJournal.emptyTitle')} description={t('memoryJournal.emptyBody')} />
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Card className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={entry.action === 'deleted' ? 'attention' : 'neutral'}>{t(ACTION_KEYS[entry.action])}</Badge>
                      <Badge>{t(MEMORY_KIND_KEY[entry.kind])}</Badge>
                      <span className="flex-1" />
                      <time className="text-xs text-ink-3 tabular-nums" dateTime={entry.at}>
                        {formatRelativeTime(entry.at)}
                      </time>
                    </div>
                    {entry.action === 'updated' ? (
                      <div className="flex flex-col gap-0.5 text-sm">
                        <span className="line-clamp-2 text-ink-3 line-through decoration-line" title={entry.contentBefore ?? ''}>
                          <span className="sr-only">{t('memoryJournal.before')}: </span>
                          {entry.contentBefore ?? ''}
                        </span>
                        <span className="line-clamp-2 text-ink" title={entry.contentAfter ?? ''}>
                          <span className="sr-only">{t('memoryJournal.after')}: </span>
                          {entry.contentAfter ?? ''}
                        </span>
                      </div>
                    ) : (
                      <p className="m-0 line-clamp-2 text-sm whitespace-pre-wrap">{entry.action === 'created' ? (entry.contentAfter ?? '') : (entry.contentBefore ?? '')}</p>
                    )}
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" disabled={busyId !== null} onClick={() => setConfirming(entry)}>
                        <Clock size={14} />
                        {t('memoryJournal.undo')}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            <p className="m-0 text-xs text-ink-3">{t('memoryJournal.limit', { count: '50' })}</p>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={t(confirming?.action === 'created' ? 'memoryJournal.undoRemoveTitle' : 'memoryJournal.undoRestoreTitle')}
        description={t(confirming?.action === 'created' ? 'memoryJournal.undoRemoveBody' : 'memoryJournal.undoRestoreBody')}
        confirmLabel={t(confirming?.action === 'created' ? 'memoryJournal.undoRemoveAction' : 'memoryJournal.undoRestoreAction')}
        tone={confirming?.action === 'created' ? 'danger' : 'primary'}
        onConfirm={async () => {
          if (confirming !== null) await undo(confirming);
        }}
        onClose={() => setConfirming(null)}
      />
    </Dialog>
  );
}

const ACTION_KEYS = {
  created: 'memoryJournal.action.created',
  updated: 'memoryJournal.action.updated',
  deleted: 'memoryJournal.action.deleted',
} as const satisfies Record<MemoryJournalEntry['action'], string>;
