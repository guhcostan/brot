import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { Bot } from '@brot/protocol';
import { BotAvatar, Button } from '@brot/ui';
import { avatarOf } from '../format';
import { t } from '../i18n';
import { activeMention, findMentions, insertMention, matchMembers } from '../mentions';

export interface ComposerProps {
  /** Who the message goes to, for the label and placeholder: a bot's name or a room's title. */
  targetName: string;
  /** Overrides the default placeholder. */
  placeholder?: string;
  /** A short line under the field, e.g. the room's responder rule. */
  note?: string;
  /** Bots that can be @mentioned. Enables the mention menu. */
  members?: readonly Bot[];
  onSend: (content: string, mentions: string[]) => Promise<void>;
}

const MAX_HEIGHT = 200;
const MAX_OPTIONS = 6;

export function Composer({ targetName, placeholder, note, members, onSend }: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const listId = useId();
  const canSend = draft.trim().length > 0 && !busy;

  const mention = members && members.length > 0 ? activeMention(draft, caret) : null;
  const options = useMemo(
    () => (mention && members ? matchMembers(members, mention.query).slice(0, MAX_OPTIONS) : []),
    [mention?.query, mention?.start, members],
  );
  const open = mention !== null && options.length > 0 && dismissedAt !== mention.start;
  const active = open ? Math.min(highlight, options.length - 1) : -1;
  const optionId = (index: number) => `${listId}-opt-${index}`;

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  const choose = (bot: Bot) => {
    if (!mention) return;
    const next = insertMention(draft, mention, bot.name);
    setDraft(next.text);
    setCaret(next.caret);
    setHighlight(0);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(next.caret, next.caret);
    });
  };

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(content, members ? findMentions(content, members) : []);
      setDraft('');
      setCaret(0);
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
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setHighlight((active + step + options.length) % options.length);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.nativeEvent.isComposing) {
        const bot = options[active];
        if (bot) {
          event.preventDefault();
          choose(bot);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedAt(mention?.start ?? null);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const syncCaret = () => setCaret(fieldRef.current?.selectionStart ?? draft.length);

  return (
    <form onSubmit={onSubmit} className="flex-none bg-bg px-3 pt-2 pb-3 md:px-6 md:pb-5">
      <div className="relative mx-auto flex w-full max-w-[720px] flex-col gap-2">
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={t('composer.mentionList')}
            className="absolute right-0 bottom-full left-0 z-10 m-0 mb-2 flex max-w-[360px] list-none flex-col gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-float"
          >
            {options.map((bot, index) => {
              const avatar = avatarOf(bot);
              return (
                <li
                  key={bot.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(bot)}
                  onMouseEnter={() => setHighlight(index)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 aria-selected:bg-surface-2"
                >
                  <BotAvatar shape={avatar.shape} color={avatar.color} size={22} />
                  <span className="text-sm font-medium text-ink">{bot.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{bot.job}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div
          className="flex items-end gap-2 rounded-xl border border-line bg-surface py-2 pr-2 pl-4 shadow-float transition-colors duration-[var(--dur-fast)] focus-within:border-focus focus-within:shadow-[0_0_0_1px_var(--focus),var(--shadow-float)] data-[error=true]:border-attention"
          data-error={error ? 'true' : undefined}
        >
          <label htmlFor={fieldId} className="brot-sr-only">
            {t('composer.label', { name: targetName })}
          </label>
          <textarea
            ref={fieldRef}
            id={fieldId}
            rows={1}
            value={draft}
            placeholder={placeholder ?? t('composer.placeholder', { name: targetName })}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            aria-invalid={error ? true : undefined}
            {...(members
              ? {
                  role: 'combobox',
                  'aria-autocomplete': 'list' as const,
                  'aria-expanded': open,
                  'aria-controls': open ? listId : undefined,
                  'aria-activedescendant': active >= 0 ? optionId(active) : undefined,
                }
              : {})}
            onChange={(event) => {
              setDraft(event.target.value);
              setCaret(event.target.selectionStart);
              setHighlight(0);
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') syncCaret();
            }}
            onClick={syncCaret}
            onBlur={() => setDismissedAt(mention?.start ?? null)}
            onFocus={() => setDismissedAt(null)}
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
            <span className="text-ink-3">{note}</span>
          )}
          <span id={hintId} className="hidden text-ink-3 sm:inline">
            {members ? t('composer.hintMentions') : t('composer.hint')}
          </span>
        </div>
      </div>
    </form>
  );
}
