import { useId, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { Button, Textarea } from '@brot/ui';
import { t } from '../i18n';

export interface ComposerProps {
  botName: string;
  onSend: (content: string) => Promise<void>;
}

export function Composer({ botName, onSend }: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const canSend = draft.trim().length > 0 && !busy;

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(content);
      setDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-line bg-surface p-3 md:p-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Textarea
            label={t('composer.label', { name: botName })}
            hideLabel
            rows={2}
            value={draft}
            placeholder={t('composer.placeholder', { name: botName })}
            aria-describedby={hintId}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            error={error ?? undefined}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!canSend}>
          {t('composer.send')}
        </Button>
      </div>
      <span id={hintId} className="text-xs text-ink-2">
        {t('composer.hint')}
      </span>
    </form>
  );
}
