import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { MemoryScope } from '@brot/protocol';
import { Badge, Button, Card, EmptyState, Skeleton } from '@brot/ui';
import type { MemoryUpkeepReport } from '../data/client';
import { t } from '../i18n';
import { useClient } from './client';
import { Dialog } from './Dialog';
import { MEMORY_KIND_KEY } from './memoryShared';

export interface MemoryUpkeepDialogProps {
  open: boolean;
  scope: MemoryScope;
  botId?: string;
  botName?: string;
  onClose: () => void;
  /** Refreshes the visible memory list after duplicates are removed. */
  onChanged: () => Promise<unknown> | unknown;
  /** A report to render before the client load resolves, e.g. in an SSR render. */
  initialReport?: MemoryUpkeepReport;
  /** Starts showing the removed-N line, for SSR previews and tests. */
  initialResult?: string;
  /** Starts showing this error instead of loading, for SSR previews and tests. */
  initialError?: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings/memory upkeep: preview duplicate notes and merge them, keeping the newest of each group. */
export function MemoryUpkeepDialog({
  open,
  scope,
  botId,
  botName,
  onClose,
  onChanged,
  initialReport,
  initialResult,
  initialError,
}: MemoryUpkeepDialogProps): ReactElement {
  const client = useClient();
  const [report, setReport] = useState<MemoryUpkeepReport | null>(initialReport ?? null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [result, setResult] = useState<string | null>(initialResult ?? null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReport(await client.getMemoryUpkeep({ scope, ...(botId === undefined ? {} : { botId }) }));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setReport((current) => current ?? { scope, total: 0, removable: 0, groups: [] });
    }
  }, [botId, client, scope]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const apply = async () => {
    if (report === null || busy) return;
    const removeIds = report.groups.flatMap((group) => group.remove.map((memory) => memory.id));
    if (removeIds.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await client.applyMemoryUpkeep({ scope, ...(botId === undefined ? {} : { botId }), removeIds });
      setResult(t('memoryUpkeep.result', { count: String(outcome.removed.length) }));
      await onChanged();
      await load();
    } catch (cause) {
      setError(messageOf(cause));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const description = scope === 'bot' ? t('memoryUpkeep.descriptionBot', { name: botName ?? t('team.unknownBot') }) : t('memoryUpkeep.descriptionWorkspace');
  const clean = report !== null && report.removable === 0;

  return (
    <Dialog open={open} size="md" title={t('memoryUpkeep.title')} description={description} onClose={onClose}>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
        {report === null ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
            {[0, 1].map((key) => (
              <Skeleton key={key} shape="block" height={84} />
            ))}
          </div>
        ) : clean ? (
          <EmptyState title={t('memoryUpkeep.emptyTitle')} description={t('memoryUpkeep.emptyBody')} />
        ) : (
          <>
            <p className="m-0 text-sm text-ink-2">{t('memoryUpkeep.summary', { removable: String(report.removable) })}</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {report.groups.map((group) => {
                const firstDuplicate = group.remove[0];
                return (
                  <li key={group.keep.id}>
                    <Card className="flex flex-col gap-2 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{t(MEMORY_KIND_KEY[group.kind])}</Badge>
                        <Badge>{t('memoryUpkeep.keptLabel')}</Badge>
                      </div>
                      <p className="m-0 line-clamp-2 text-sm">{group.keep.content}</p>
                      {firstDuplicate !== undefined ? (
                        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-2">
                          <span className="text-xs font-medium text-ink-2">{t('memoryUpkeep.removedLabel')}</span>
                          <span className="line-clamp-2 text-xs text-ink-3 line-through decoration-line">{firstDuplicate.content}</span>
                          <span className="text-xs text-ink-2">{t('memoryUpkeep.duplicates', { count: String(group.remove.length) })}</span>
                        </div>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {error !== null ? (
          <p role="alert" className="m-0 text-sm text-attention-text">
            {error}
          </p>
        ) : result !== null ? (
          <p role="status" className="m-0 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-sm text-ink-2">
            {result}
          </p>
        ) : null}

        {report !== null ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('dialog.close')}
            </Button>
            <Button variant="primary" disabled={clean || busy} onClick={() => void apply()}>
              {t('memoryUpkeep.action')}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
