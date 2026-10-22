import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Button, Textarea } from '@brot/ui';
import type { CreateMemory, MemoryKind, UpdateMemory } from '../data/client';
import { t } from '../i18n';
import { MEMORY_KINDS, MEMORY_KIND_KEY } from './memoryShared';

/** The fields the editor needs; both bot memories and workspace facts fit it. */
export interface MemoryDraft {
  id: string;
  kind: MemoryKind;
  content: string;
}

export interface MemoryFormProps {
  /** The entry being edited; absent creates a new one. */
  memory?: MemoryDraft | undefined;
  onClose: () => void;
  onCreate: (input: CreateMemory) => Promise<unknown>;
  onUpdate: (memoryId: string, patch: UpdateMemory) => Promise<unknown>;
}

/** The shared kind + content editor behind both the bot Memory tab and Settings → About me. */
export function MemoryForm({ memory, onClose, onCreate, onUpdate }: MemoryFormProps): ReactElement {
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
      if (memory !== undefined) await onUpdate(memory.id, { kind, content: content.trim() });
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
          {MEMORY_KINDS.map((option) => (
            <option key={option} value={option}>
              {t(MEMORY_KIND_KEY[option])}
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
          {t(memory !== undefined ? 'memory.save' : 'memory.create')}
        </Button>
      </div>
    </form>
  );
}
