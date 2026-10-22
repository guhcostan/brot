import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Badge, Button, Card, EmptyState, Skeleton, Textarea } from '@brot/ui';
import type { CreateMemory, Memory, MemoryKind, UpdateMemory } from '../data/client';
import { t, type TranslationKey } from '../i18n';
import { Dialog, ConfirmDialog } from './Dialog';
import { Plus, Trash } from './icons';

export interface MemoryTabProps {
  botName: string;
  /** undefined while the list loads. */
  memories: Memory[] | undefined;
  error?: string;
  onCreate: (input: CreateMemory) => Promise<unknown>;
  onUpdate: (memoryId: string, patch: UpdateMemory) => Promise<unknown>;
  onDelete: (memoryId: string) => Promise<unknown>;
}

const KIND_KEY: Record<MemoryKind, TranslationKey> = {
  fact: 'memory.kind.fact',
  preference: 'memory.kind.preference',
  summary: 'memory.kind.summary',
};

const KINDS: readonly MemoryKind[] = ['fact', 'preference', 'summary'];

const savedOnFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** What a bot remembers: every entry is editable, and every run recalls only the most relevant ones. */
export function MemoryTab({ botName, memories, error, onCreate, onUpdate, onDelete }: MemoryTabProps): ReactElement {
  const [dialog, setDialog] = useState<{ memory?: Memory } | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium text-ink-2">{t('memory.count', { count: String(memories?.length ?? 0) })}</h3>
        <Button variant="secondary" size="sm" onClick={() => setDialog({})}>
          <Plus size={14} />
          {t('memory.new')}
        </Button>
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
                  <Badge>{t(KIND_KEY[memory.kind])}</Badge>
                  <time className="text-xs text-ink-3 tabular-nums" dateTime={memory.createdAt}>
                    {savedOnFormat.format(new Date(memory.createdAt))}
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

function MemoryForm({
  memory,
  onClose,
  onCreate,
  onUpdate,
}: {
  memory?: Memory | undefined;
  onClose: () => void;
  onCreate: (input: CreateMemory) => Promise<unknown>;
  onUpdate: (memoryId: string, patch: UpdateMemory) => Promise<unknown>;
}): ReactElement {
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? 'fact');
  const [content, setContent] = useState(memory?.content ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const kindId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (content.trim() === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (memory) await onUpdate(memory.id, { kind, content: content.trim() });
      else await onCreate({ kind, content: content.trim() });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-4 pb-5" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor={kindId} className="text-sm font-medium">
          {t('memory.kind')}
        </label>
        <select id={kindId} value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)} className="brot-input">
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {t(KIND_KEY[option])}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        label={t('memory.content')}
        hint={t('memory.contentHint')}
        placeholder={t('memory.contentPlaceholder')}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        error={tried && content.trim() === '' ? t('memory.contentRequired') : undefined}
        rows={4}
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
          {t(memory ? 'memory.save' : 'memory.create')}
        </Button>
      </div>
    </form>
  );
}
