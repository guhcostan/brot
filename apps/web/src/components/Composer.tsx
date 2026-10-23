import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_MESSAGE,
  isAllowedAttachmentMime,
  type Attachment,
  type Bot,
} from '@brot/protocol';
import { BotAvatar, Button, cx } from '@brot/ui';
import { avatarOf, formatBytes } from '../format';
import { getLocale, t } from '../i18n';
import { activeMention, findMentions, insertMention, matchMembers } from '../mentions';
import {
  COMMANDS,
  isValidModelRef,
  isKnownCommand,
  insertDictation,
  parseCommand,
  suggestCommands,
  type CommandSpec,
  type ParsedCommand,
} from './composerCommands';
import { finalTranscript, getSpeechRecognition, speechLanguage, type SpeechRecognitionLike } from './dictation';
import { Close, FileDoc, Mic, Paperclip } from './icons';

export interface ComposerProps {
  /** Who the message goes to, for the label and placeholder: a bot's name or a room's title. */
  targetName: string;
  /** Overrides the default placeholder. */
  placeholder?: string;
  /** A short line under the field, e.g. the room's responder rule. */
  note?: string;
  /** Bots that can be @mentioned. Enables the mention menu. */
  members?: readonly Bot[];
  /** Uploads one file into the conversation; enables the paperclip and drag-and-drop. */
  uploadAttachment?: (file: File) => Promise<Attachment>;
  /** Deletes an upload that failed to become part of a message, so a cancelled send leaves nothing. */
  discardAttachment?: (attachment: Attachment) => Promise<void>;
  onSend: (content: string, mentions: string[], attachmentIds: string[]) => Promise<void>;
  /** Files to start with, for SSR previews and tests. */
  initialFiles?: readonly File[];
  /** Starts in the uploading state, for SSR previews and tests. */
  initialUploading?: boolean;
  /** Runs a recognized slash command; resolves to an inline message, or null when it was handled. */
  onCommand?: (name: string, args: string) => Promise<string | null>;
  /** The conversation is a room, where direct-message commands are refused. */
  isRoom?: boolean;
  /** Placeholder draft text, for SSR previews and tests. */
  initialDraft?: string;
  /** Starts with this command hint shown, for SSR previews and tests. */
  initialCommandHint?: string | null;
  /** Starts with the command list open, for SSR previews and tests. */
  initialHelpOpen?: boolean;
  /** Dictation state to render before any click, for SSR previews and tests. */
  initialDictation?: 'idle' | 'listening' | 'unsupported';
  /** The object SpeechRecognition is looked up on; tests pass a fake scope. */
  speechScope?: unknown;
}

const MAX_HEIGHT = 200;
const MAX_OPTIONS = 6;

interface PendingFile {
  key: number;
  file: File;
  /** A localized error, e.g. too large or an unsupported type. */
  error?: string;
}

/** Why a file cannot be attached, localized; undefined when the server will accept it. */
function attachmentProblem(file: File): string | undefined {
  if (file.size > ATTACHMENT_MAX_BYTES) return t('composer.attachTooBig', { name: file.name });
  if (!isAllowedAttachmentMime(file.type)) return t('composer.attachUnsupported', { name: file.name });
  return undefined;
}

export function Composer({
  targetName,
  placeholder,
  note,
  members,
  uploadAttachment,
  discardAttachment,
  onSend,
  initialFiles,
  initialUploading = false,
  onCommand,
  isRoom = false,
  initialDraft,
  initialCommandHint,
  initialHelpOpen = false,
  initialDictation = 'idle',
  speechScope,
}: ComposerProps): ReactElement {
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(initialUploading);
  const [error, setError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingFile[]>(() => {
    const files = (initialFiles ?? []).slice(0, ATTACHMENT_MAX_PER_MESSAGE);
    return files.map((file, index) => {
      const problem = attachmentProblem(file);
      return { key: index, file, ...(problem === undefined ? {} : { error: problem }) };
    });
  });
  const [dragging, setDragging] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [commandHint, setCommandHint] = useState<string | null>(initialCommandHint ?? null);
  const [commandDismissed, setCommandDismissed] = useState<string | null>(null);
  const [commandHighlight, setCommandHighlight] = useState(0);
  const [helpOpen, setHelpOpen] = useState(initialHelpOpen);
  const [dictationError, setDictationError] = useState<string | null>(initialDictation === 'unsupported' ? t('composer.dictationUnsupported') : null);
  const [listening, setListening] = useState(initialDictation === 'listening');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef((initialFiles ?? []).length);
  const dragDepth = useRef(0);
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const listId = useId();
  const attachable = uploadAttachment !== undefined;
  const fileErrors = pending.some((item) => item.error !== undefined);
  const canSend = draft.trim().length > 0 && !busy && !uploading && !fileErrors;

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const mention = members && members.length > 0 ? activeMention(draft, caret) : null;
  const options = useMemo(
    () => (mention && members ? matchMembers(members, mention.query).slice(0, MAX_OPTIONS) : []),
    [mention?.query, mention?.start, members],
  );
  const mentionOpen = mention !== null && options.length > 0 && dismissedAt !== mention.start;
  const active = mentionOpen ? Math.min(highlight, options.length - 1) : -1;
  const optionId = (index: number) => `${listId}-opt-${index}`;
  const commandPrefix = draft.trim().startsWith('/') && !draft.trim().includes(' ') ? draft.trim() : null;
  const commandSuggestions = commandPrefix !== null ? suggestCommands(commandPrefix) : [];
  const commandMenuOpen = !helpOpen && commandPrefix !== null && commandDismissed !== commandPrefix && commandSuggestions.length > 0;
  const commandItems = helpOpen ? COMMANDS : commandSuggestions;
  const availableCommands = commandItems.length;
  const activeCommand = commandMenuOpen || helpOpen ? Math.min(commandHighlight, Math.max(0, availableCommands - 1)) : -1;
  const commandListId = `${listId}-commands`;

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

  const selectCommand = (command: CommandSpec) => {
    const text = command.name === 'rename' || command.name === 'model' ? `/${command.name} ` : `/${command.name}`;
    setDraft(text);
    setCaret(text.length);
    setCommandDismissed(null);
    setHelpOpen(false);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(text.length, text.length);
    });
  };

  const runCommand = async (command: ParsedCommand) => {
    setHelpOpen(false);
    if (command.name === 'help') {
      setHelpOpen(true);
      setCommandHint(null);
      setDraft('');
      setCaret(0);
      return;
    }
    if (!isKnownCommand(command.name)) {
      setCommandHint(t('composer.commands.unknown', { command: `/${command.name}` }));
      return;
    }
    const spec = COMMANDS.find((entry) => entry.name === command.name);
    if (spec?.directOnly === true && isRoom) {
      setCommandHint(t('composer.commands.roomUnavailable'));
      return;
    }
    if (command.name === 'rename' && command.args === '') {
      setCommandHint(t('composer.commands.renameUsage'));
      return;
    }
    if (command.name === 'model' && command.args !== 'default' && (command.args === '' || !isValidModelRef(command.args))) {
      setCommandHint(t(command.args === '' ? 'composer.commands.modelUsage' : 'composer.commands.modelInvalid'));
      return;
    }
    if (onCommand === undefined) {
      setCommandHint(t('composer.commands.unavailable'));
      return;
    }
    setBusy(true);
    setCommandHint(null);
    try {
      const result = await onCommand(command.name, command.args);
      if (result === null) {
        setDraft('');
        setCaret(0);
      } else {
        setCommandHint(result);
      }
    } catch (cause) {
      setCommandHint(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const dictate = () => {
    setDictationError(null);
    setCommandHint(null);
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const Recognition = getSpeechRecognition(speechScope);
    if (Recognition === undefined) {
      setDictationError(t('composer.dictationUnsupported'));
      return;
    }
    const recognition = new Recognition();
    recognition.lang = speechLanguage(getLocale());
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const transcript = finalTranscript(event);
      if (transcript === '') return;
      const at = fieldRef.current?.selectionStart ?? draft.length;
      const next = insertDictation(draft, at, transcript);
      setDraft(next.text);
      setCaret(next.caret);
      requestAnimationFrame(() => fieldRef.current?.setSelectionRange(next.caret, next.caret));
    };
    recognition.onerror = (event) => {
      setDictationError(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? t('composer.dictationDenied') : t('composer.dictationFailed'));
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      setDictationError(t('composer.dictationUnsupported'));
    }
  };

  const addFiles = (files: FileList | readonly File[] | null | undefined) => {
    if (!attachable || !files) return;
    const incoming = [...files];
    if (incoming.length === 0) return;
    const room = Math.max(0, ATTACHMENT_MAX_PER_MESSAGE - pending.length);
    setAttachError(incoming.length > room ? t('composer.attachTooMany', { max: String(ATTACHMENT_MAX_PER_MESSAGE) }) : null);
    const next: PendingFile[] = incoming.slice(0, room).map((file) => {
      const problem = attachmentProblem(file);
      return { key: (keyRef.current += 1), file, ...(problem === undefined ? {} : { error: problem }) };
    });
    if (next.length > 0) setPending((current) => [...current, ...next]);
  };

  const removeFile = (key: number) => {
    setPending((current) => current.filter((item) => item.key !== key));
    setAttachError(null);
  };

  const discardUploads = async (uploads: readonly Attachment[]) => {
    if (discardAttachment === undefined || uploads.length === 0) return;
    await Promise.all(uploads.map((attachment) => discardAttachment(attachment).catch(() => undefined)));
  };

  const markFailed = (key: number, cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setPending((current) => current.map((item) => (item.key === key ? { ...item, error: t('composer.uploadFailed', { message }) } : item)));
  };

  // Files upload on send, not on pick: a message that is never sent leaves no bytes behind.
  const submit = async () => {
    const content = draft.trim();
    if (!content || busy || uploading || fileErrors) return;
    const command = parseCommand(content);
    if (command !== null) {
      await runCommand(command);
      return;
    }
    setBusy(true);
    setError(null);
    setAttachError(null);
    const uploaded: Attachment[] = [];
    try {
      if (pending.length > 0) {
        if (uploadAttachment === undefined) return;
        setUploading(true);
        for (const item of pending) {
          try {
            uploaded.push(await uploadAttachment(item.file));
          } catch (cause) {
            markFailed(item.key, cause);
            await discardUploads(uploaded);
            return;
          }
        }
        setUploading(false);
      }
      await onSend(
        content,
        members ? findMentions(content, members) : [],
        uploaded.map((attachment) => attachment.id),
      );
      setDraft('');
      setCaret(0);
      setPending([]);
    } catch (cause) {
      // The message never existed, so drop the bytes it would have carried.
      await discardUploads(uploaded);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (helpOpen || commandMenuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setCommandHighlight((activeCommand + step + availableCommands) % availableCommands);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.nativeEvent.isComposing) {
        const command = commandItems[activeCommand];
        const exact = draft.trim().toLowerCase();
        if (command !== undefined && (command.name === 'help' || command.name === 'new' || command.name === 'stop') && exact === `/${command.name}`) {
          event.preventDefault();
          setHelpOpen(false);
          setCommandDismissed(null);
          const runnable = parseCommand(draft);
          if (runnable !== null) void runCommand(runnable);
          return;
        }
        if (command !== undefined) {
          event.preventDefault();
          selectCommand(command);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (helpOpen) setHelpOpen(false);
        else setCommandDismissed(commandPrefix);
        return;
      }
    }
    if (event.key === 'Escape' && (commandHint !== null || dictationError !== null)) {
      event.preventDefault();
      setCommandHint(null);
      setDictationError(null);
      return;
    }
    if (mentionOpen) {
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

  const carriesFiles = (event: DragEvent<HTMLFormElement>) => event.dataTransfer.types.includes('Files');

  const onDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!attachable || !carriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!attachable || !carriesFiles(event)) return;
    event.preventDefault();
  };

  const onDragLeave = () => {
    if (!attachable) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!attachable) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const syncCaret = () => setCaret(fieldRef.current?.selectionStart ?? draft.length);

  return (
    <form
      onSubmit={onSubmit}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="flex-none bg-bg px-3 pt-2 pb-3 md:px-6 md:pb-5"
    >
      <div className="relative mx-auto flex w-full max-w-[720px] flex-col gap-2">
        {helpOpen || commandMenuOpen ? (
          <ul
            id={commandListId}
            role="listbox"
            aria-label={t('composer.commands.menuLabel')}
            className="absolute right-0 bottom-full left-0 z-10 m-0 mb-2 flex max-w-[420px] list-none flex-col gap-0.5 rounded-lg border border-line bg-surface p-1 shadow-float"
          >
            {commandItems.map((command, index) => (
              <li
                key={command.name}
                id={`${commandListId}-${index}`}
                role="option"
                aria-selected={index === activeCommand}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCommand(command)}
                onMouseEnter={() => setCommandHighlight(index)}
                className="flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 aria-selected:bg-surface-2"
              >
                <code className="flex-none font-mono text-xs text-ink-3">{command.usage}</code>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{t(command.descriptionKey)}</span>
              </li>
            ))}
            {helpOpen ? <li className="px-2 py-1 text-xs text-ink-3">{t('composer.commands.hint')}</li> : null}
          </ul>
        ) : null}

        {mentionOpen ? (
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

        {pending.length > 0 ? (
          <ul aria-label={t('composer.pendingFiles')} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {pending.map((item) => (
              <li key={item.key} className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cx(
                    'inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs',
                    item.error === undefined ? 'border-line bg-surface-2 text-ink-2' : 'border-attention text-attention-text',
                  )}
                >
                  <span className="flex flex-none text-ink-3">
                    <FileDoc size={13} />
                  </span>
                  <span className="min-w-0 truncate text-ink">{item.file.name}</span>
                  <span className="flex-none text-ink-3 tabular-nums">{formatBytes(item.file.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeFile(item.key)}
                    aria-label={t('composer.removeFile', { name: item.file.name })}
                    title={t('composer.removeFile', { name: item.file.name })}
                    className="flex-none rounded-sm text-ink-3 hover:text-ink"
                  >
                    <Close size={12} />
                  </button>
                </span>
                {item.error === undefined ? null : (
                  <span role="alert" className="px-1 text-xs text-attention-text">
                    {item.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {attachError ? (
          <p role="alert" className="m-0 px-1 text-xs text-attention-text">
            {attachError}
          </p>
        ) : null}

        <div
          data-dragging={dragging ? 'true' : undefined}
          className="flex items-end gap-2 rounded-xl border border-line bg-surface py-2 pr-2 pl-2 shadow-float transition-colors duration-[var(--dur-fast)] focus-within:border-focus focus-within:shadow-[0_0_0_1px_var(--focus),var(--shadow-float)] data-[error=true]:border-attention data-[dragging=true]:border-focus data-[dragging=true]:shadow-[0_0_0_1px_var(--focus),var(--shadow-float)]"
          data-error={error ? 'true' : undefined}
        >
          <label htmlFor={fieldId} className="brot-sr-only">
            {t('composer.label', { name: targetName })}
          </label>
          <input
            ref={fileRef}
            type="file"
            multiple
            tabIndex={-1}
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {attachable ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileRef.current?.click()}
              disabled={busy || uploading}
              aria-label={t('composer.attach')}
              title={t('composer.attach')}
              className="mb-0.5 !size-9 flex-none"
            >
              <Paperclip size={16} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={dictate}
            disabled={initialDictation === 'unsupported'}
            aria-label={t(initialDictation === 'unsupported' ? 'composer.dictationUnsupported' : listening ? 'composer.dictationStop' : 'composer.dictate')}
            title={t(initialDictation === 'unsupported' ? 'composer.dictationUnsupported' : listening ? 'composer.dictationStop' : 'composer.dictate')}
            aria-pressed={listening}
            className={cx('mb-0.5 !size-9 flex-none', listening && 'text-attention-text')}
          >
            <Mic size={16} />
          </Button>
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
                  'aria-expanded': mentionOpen,
                  'aria-controls': mentionOpen ? listId : undefined,
                  'aria-activedescendant': active >= 0 ? optionId(active) : undefined,
                }
              : {})}
            onChange={(event) => {
              setDraft(event.target.value);
              setCaret(event.target.selectionStart);
              setHighlight(0);
              setCommandDismissed(null);
              setCommandHighlight(0);
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
          ) : commandHint !== null || dictationError !== null ? (
            <span role="alert" className="text-attention-text">
              {commandHint ?? dictationError}
            </span>
          ) : (
            <span className="text-ink-3" aria-live="polite">
              {uploading ? t('composer.uploading') : note}
            </span>
          )}
          <span id={hintId} className="hidden text-ink-3 sm:inline">
            {members ? t('composer.hintMentions') : attachable ? t('composer.hintAttach') : t('composer.hint')}
            {' · '}
            {t('composer.commands.hint')}
          </span>
        </div>
      </div>
    </form>
  );
}
