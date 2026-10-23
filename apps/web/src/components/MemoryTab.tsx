import { useState, type ReactElement } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton } from '@brot/ui';
import type { CreateMemory, Memory, UpdateMemory } from '../data/client';
import { t } from '../i18n';
import { Dialog, ConfirmDialog } from './Dialog';
import { MemoryForm } from './MemoryForm';
import { MEMORY_KIND_KEY, memorySavedOnFormat } from './memoryShared';
import { Clock, Plus, Trash } from './icons';

export interface MemoryTabProps {
  botName: string;
  /** undefined while the list loads. */
  memories: Memory[] | undefined;
  error?: string;
  onCreate: (input: CreateMemory) => Promise<unknown>;
  onUpdate: (memoryId: string, patch: UpdateMemory) => Promise<unknown>;
  onDelete: (memoryId: string) => Promise<unknown>;
  /** Opens the memory journal; absent hides the History action. */
  onOpenHistory?: () => void;
}

/** What a bot remembers: every entry is editable, and every run recalls only the most relevant ones. */
export function MemoryTab({ botName, memories, error, onCreate, onUpdate, onDelete, onOpenHistory }: MemoryTabProps): ReactElement {
  const [dialog, setDialog] = useState<{ memory?: Memory } | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium text-ink-2">{t('memory.count', { count: String(memories?.length ?? 0) })}</h3>
        <span className="flex items-center gap-2">
          {onOpenHistory !== undefined ? (
            <Button variant="ghost" size="sm" onClick={onOpenHistory}>
              <Clock size={14} />
              {t('memory.history')}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
            <Plus size={14} />
            {t('memory.new')}
          </Button>
        </span>
      </div>

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {memories === undefined ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton shape="block" height={64} />
          <Skeleton shape="block" height={64} />
        </div>
      ) : memories.length === 0 ? (
        <EmptyState title={t('memory.emptyTitle')} description={t('memory.emptyBody', { name: botName })} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {memories.map((memory) => (
            <li key={memory.id}>
              <Card className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge>{t(MEMORY_KIND_KEY[memory.kind])}</Badge>
                  <time className="text-xs text-ink-3 tabular-nums" dateTime={memory.createdAt}>
                    {memorySavedOnFormat.format(new Date(memory.createdAt))}
                  </time>
                </div>
                <p className="m-0 line-clamp-3 text-sm whitespace-pre-wrap">{memory.content}</p>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ memory })}>
                    {t('memory.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(memory)}
                    aria-label={t('memory.delete')}
                    title={t('memory.delete')}
                    className="text-ink-3"
                  >
                    <Trash size={14} />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialog !== null} title={t(dialog?.memory ? 'memory.editTitle' : 'memory.newTitle')} onClose={() => setDialog(null)}>
        {dialog !== null ? (
          <MemoryForm memory={dialog.memory} onClose={() => setDialog(null)} onCreate={onCreate} onUpdate={onUpdate} />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        title={t('memory.deleteTitle')}
        description={t('memory.deleteBody')}
        confirmLabel={t('memory.delete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await onDelete(deleting.id);
            setDeleting(null);
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
