import { useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from '@brot/ui';
import { t } from '../i18n';

export interface ComposerProps {
  botName: string;
  onSend: (content: string) => Promise<void>;
}

const MAX_HEIGHT = 200;

export function Composer({ botName, onSend }: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const canSend = draft.trim().length > 0 && !busy;

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

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
    <form onSubmit={onSubmit} className="flex-none bg-bg px-3 pt-2 pb-3 md:px-6 md:pb-5">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
        <div
          className="flex items-end gap-2 rounded-xl border border-line bg-surface py-2 pr-2 pl-4 shadow-float transition-colors duration-[var(--dur-fast)] focus-within:border-focus focus-within:shadow-[0_0_0_1px_var(--focus),var(--shadow-float)] data-[error=true]:border-attention"
          data-error={error ? 'true' : undefined}
        >
          <label htmlFor={fieldId} className="brot-sr-only">
            {t('composer.label', { name: botName })}
          </label>
          <textarea
            ref={fieldRef}
            id={fieldId}
            rows={1}
            value={draft}
            placeholder={t('composer.placeholder', { name: botName })}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            className="max-h-[200px] min-h-9 flex-1 resize-none border-0 bg-transparent py-[7px] text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-3"
          />
          <Button type="submit" variant="primary" size="icon" disabled={!canSend} aria-label={t('composer.send')}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 15.5v-11M5 9l5-5 5 5" />
            </svg>
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 px-1 text-xs">
          {error ? (
            <span id={errorId} role="alert" className="text-attention-text">
              {error}
            </span>
          ) : (
            <span />
          )}
          <span id={hintId} className="hidden text-ink-3 sm:inline">
            {t('composer.hint')}
          </span>
        </div>
      </div>
    </form>
  );
}
