import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type WheelEvent,
} from 'react';
import type { Bot, ComputerInput, Takeover } from '@brot/protocol';
import { BotAvatar, Button, Skeleton, TypingIndicator, cx, toolKind } from '@brot/ui';
import { ScreenUnavailable, type ComputerInfo } from '../data/client';
import { avatarOf } from '../format';
import { t } from '../i18n';
import type { ThreadState, ToolItem } from '../state/thread';
import { useClient } from './client';
import { keyToInput, toScreenPoint, wheelToDy } from './computerInput';
import { Dialog } from './Dialog';
import { Expand, Hand, Play } from './icons';
import { describeAction, toStep } from './toolLabels';

const FRAME_MS = 250;
const INFO_MS = 5000;
const TYPE_FLUSH_MS = 90;

const COMPUTER_KINDS = new Set(['open', 'snapshot', 'click', 'type', 'key', 'scroll', 'back', 'tabs', 'screenshot', 'takeover']);

/** The bot's latest browser or computer tool call in this thread. */
export function lastComputerAction(thread: ThreadState): ToolItem | undefined {
  for (let index = thread.items.length - 1; index >= 0; index -= 1) {
    const item = thread.items[index];
    if (item?.kind === 'tool' && COMPUTER_KINDS.has(toolKind(item.tool))) return item;
  }
  return undefined;
}

/** The newer of two takeover records. */
function latest(a: Takeover | null | undefined, b: Takeover | null | undefined): Takeover | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a.at) >= Date.parse(b.at) ? a : b;
}

/** Live computer state for a bot: polled while mounted, and refreshed when the thread reports a change. */
function useComputer(bot: Bot, thread: ThreadState) {
  const client = useClient();
  const [info, setInfo] = useState<ComputerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await client.getComputer(bot.id);
      setInfo(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, bot.id]);

  useEffect(() => {
    if (bot.computer === 'none') return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, INFO_MS);
    return () => clearInterval(timer);
  }, [refresh, bot.computer, bot.desktop, thread.computerState, thread.takeover]);

  const takeover = latest(info?.takeover, thread.takeover);
  return { info, takeover, error, refresh, setInfo };
}

export interface ComputerSectionProps {
  bot: Bot;
  thread: ThreadState;
}

/** The context panel's computer: the live screen for desktop bots, a status card for headless ones. */
export function ComputerSection({ bot, thread }: ComputerSectionProps): ReactElement {
  const client = useClient();
  const { info, takeover, error, refresh, setInfo } = useComputer(bot, thread);
  const [popOut, setPopOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const avatar = avatarOf(bot);
  const sectionRef = useRef<HTMLDivElement>(null);

  const botAsked = takeover?.active === true && takeover.requestedBy === 'bot';
  useEffect(() => {
    if (botAsked) sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [botAsked, takeover?.at]);

  if (bot.computer === 'none') {
    return (
      <div className="flex items-center gap-3 border-b border-line p-4">
        <BotAvatar species={avatar.species} color={avatar.color} mood="sleeping" size={32} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="m-0 text-base font-medium">{t('context.noComputerTitle')}</p>
          <p className="m-0 text-sm text-ink-2">{t('context.noComputerBody', { name: bot.name })}</p>
        </div>
      </div>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setInfo(await client.startComputer(bot.id));
    });

  const setControl = (active: boolean) =>
    run(async () => {
      const next = await client.setTakeover(bot.id, { active });
      setInfo((current) => (current ? { ...current, takeover: next } : current));
      void refresh();
    });

  const state = info?.state ?? (thread.computerState ?? null);
  const desktop = info?.desktop ?? bot.desktop === true;
  const width = info?.width ?? 1280;
  const height = info?.height ?? 800;
  const inControl = takeover?.active === true;
  const action = lastComputerAction(thread);
  const working = action?.status === 'running';

  return (
    <div ref={sectionRef} className="flex flex-col gap-3 border-b border-line p-4">
      {botAsked ? (
        <div role="alert" className="flex animate-[brot-rise_220ms_var(--ease)_both] items-start gap-3 rounded-lg border border-attention bg-attention-soft p-3">
          <BotAvatar species={avatar.species} color={avatar.color} mood="approval" size={28} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="m-0 text-sm font-semibold">{t('computer.botAsks', { name: bot.name })}</p>
            {takeover?.reason ? <p className="m-0 text-sm text-ink-2">{takeover.reason}</p> : null}
            <p className="m-0 text-xs text-ink-2">{t('computer.botAsksHint')}</p>
          </div>
        </div>
      ) : null}

      {desktop ? (
        <ScreenView
          bot={bot}
          state={state}
          width={width}
          height={height}
          interactive={inControl}
          paused={popOut}
          busy={busy}
          onStart={start}
        />
      ) : (
        <HeadlessCard bot={bot} state={state} busy={busy} onStart={start} />
      )}

      <div className="flex min-w-0 items-center gap-2 text-sm" aria-live="polite">
        {state === 'ready' ? (
          <span className="size-2 flex-none rounded-full bg-ink" aria-hidden="true" />
        ) : (
          <span className="size-2 flex-none rounded-full border border-ink-3" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-ink-2">
          {inControl
            ? t('computer.youHaveControl')
            : action
              ? working
                ? describeAction(action)
                : `${t('computer.last')} ${lastStepText(action)}`
              : computerStateLabel(state)}
        </span>
        {working && !inControl ? <TypingIndicator label={t('status.working')} /> : null}
      </div>

      {desktop && state === 'ready' ? (
        <div className="flex flex-wrap gap-2">
          {inControl ? (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void setControl(false)}>
              {t('computer.giveBack')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void setControl(true)}>
              <Hand size={15} />
              {t('computer.takeControl')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setPopOut(true)} aria-label={t('computer.popOut')} title={t('computer.popOut')}>
            <Expand size={15} />
            <span className="hidden sm:inline">{t('computer.popOutShort')}</span>
          </Button>
        </div>
      ) : null}

      {error || actionError ? (
        <p role="alert" className="m-0 text-xs text-attention-text">
          {actionError ?? error}
        </p>
      ) : null}

      <Dialog open={popOut} size="lg" title={t('computer.popOutTitle', { name: bot.name })} description={inControl ? t('computer.youHaveControl') : t('computer.watching')} onClose={() => setPopOut(false)}>
        {popOut ? (
          <div className="flex flex-col gap-3 p-4">
            <ScreenView bot={bot} state={state} width={width} height={height} interactive={inControl} paused={false} busy={busy} onStart={start} large />
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{action ? describeAction(action) : computerStateLabel(state)}</span>
              {inControl ? (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void setControl(false)}>
                  {t('computer.giveBack')}
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled={busy || state !== 'ready'} onClick={() => void setControl(true)}>
                  <Hand size={15} />
                  {t('computer.takeControl')}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function lastStepText(action: ToolItem): string {
  const step = toStep(action);
  return step.summary ? `${step.title ?? step.tool} · ${step.summary}` : (step.title ?? step.tool);
}

function computerStateLabel(state: ComputerInfo['state'] | null): string {
  switch (state) {
    case 'ready':
      return t('computer.state.ready');
    case 'starting':
      return t('computer.state.starting');
    case 'error':
      return t('computer.state.error');
    case 'stopped':
      return t('computer.state.stopped');
    default:
      return t('computer.state.loading');
  }
}

function HeadlessCard({ bot, state, busy, onStart }: { bot: Bot; state: ComputerInfo['state'] | null; busy: boolean; onStart: () => void }): ReactElement {
  const avatar = avatarOf(bot);
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-3">
        <BotAvatar species={avatar.species} color={avatar.color} mood={state === 'ready' ? 'idle' : state === 'starting' ? 'thinking' : 'sleeping'} size={32} />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{t('computer.headless')}</span>
          <span className="text-xs text-ink-2">{t('computer.headlessHint', { name: bot.name })}</span>
        </div>
      </div>
      {state === 'stopped' || state === 'error' ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onStart}>
          <Play size={14} />
          {t('computer.start')}
        </Button>
      ) : null}
    </div>
  );
}

interface ScreenViewProps {
  bot: Bot;
  state: ComputerInfo['state'] | null;
  width: number;
  height: number;
  /** The person has control: clicks, scroll and keys go to the desktop. */
  interactive: boolean;
  /** Stops polling, e.g. while the pop-out shows the same screen. */
  paused: boolean;
  busy: boolean;
  onStart: () => void;
  large?: boolean;
}

/**
 * The live screen, polled about four times a second while it is on screen and the tab is visible.
 * Each frame is decoded off screen before it replaces the shown one, so frames never flash.
 */
function ScreenView({ bot, state, width, height, interactive, paused, busy, onStart, large = false }: ScreenViewProps): ReactElement {
  const client = useClient();
  const boxRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<number | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const shown = useRef<string | null>(null);
  const typed = useRef('');
  const typeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wheel = useRef({ dy: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined, x: 0, y: 0 });
  const avatar = avatarOf(bot);
  const live = state === 'ready' && !paused;

  useEffect(() => {
    const box = boxRef.current;
    if (!live || !box) return;
    let stopped = false;
    let onScreen = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          onScreen = entries.at(-1)?.isIntersecting ?? true;
        })
      : undefined;
    observer?.observe(box);

    const tick = async () => {
      if (stopped) return;
      if (onScreen && document.visibilityState === 'visible') {
        controller = new AbortController();
        try {
          const blob = await client.computerScreen(bot.id, controller.signal);
          const url = URL.createObjectURL(blob);
          const image = new Image();
          image.src = url;
          await image.decode();
          if (stopped) {
            URL.revokeObjectURL(url);
            return;
          }
          const previous = shown.current;
          shown.current = url;
          setFrame(url);
          setUnavailable(null);
          if (previous) setTimeout(() => URL.revokeObjectURL(previous), 1000);
        } catch (cause) {
          if (stopped) return;
          if (cause instanceof ScreenUnavailable) setUnavailable(cause.status);
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), FRAME_MS);
    };
    void tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      observer?.disconnect();
    };
  }, [client, bot.id, live]);

  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
      clearTimeout(typeTimer.current);
      clearTimeout(wheel.current.timer);
    },
    [],
  );

  useEffect(() => {
    if (interactive) boxRef.current?.focus({ preventScroll: true });
  }, [interactive]);

  const send = useCallback(
    (input: ComputerInput) => {
      client.computerInput(bot.id, input).then(
        () => setInputError(null),
        (cause: unknown) => setInputError(cause instanceof Error ? cause.message : String(cause)),
      );
    },
    [client, bot.id],
  );

  const flushTyped = () => {
    clearTimeout(typeTimer.current);
    const text = typed.current;
    typed.current = '';
    if (text) send({ type: 'type', text });
  };

  const point = (event: { clientX: number; clientY: number }) => {
    const box = boxRef.current?.getBoundingClientRect();
    return box ? toScreenPoint(event.clientX, event.clientY, box, width, height) : { x: 0, y: 0 };
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    flushTyped();
    send({ type: 'click', ...point(event), button: 'left', double: false });
  };

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.preventDefault();
    send({ type: 'click', ...point(event), button: 'right', double: false });
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const pending = wheel.current;
    pending.dy += event.deltaY;
    Object.assign(pending, point(event));
    if (pending.timer) return;
    pending.timer = setTimeout(() => {
      const dy = wheelToDy(pending.dy);
      pending.dy = 0;
      pending.timer = undefined;
      if (dy !== 0) send({ type: 'scroll', x: pending.x, y: pending.y, dy });
    }, 120);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || event.nativeEvent.isComposing) return;
    const input = keyToInput(event);
    if (!input) return;
    event.preventDefault();
    if (input.type === 'type') {
      typed.current += input.text;
      clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(flushTyped, TYPE_FLUSH_MS);
      return;
    }
    flushTyped();
    send(input);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const text = event.clipboardData.getData('text/plain').slice(0, 2000);
    if (!text) return;
    event.preventDefault();
    flushTyped();
    send({ type: 'type', text });
  };

  const label = interactive ? t('computer.screenControl', { name: bot.name }) : t('computer.screenWatch', { name: bot.name });

  return (
    <div className="mx-auto flex w-full flex-col gap-1.5" style={large ? { maxWidth: `calc((100dvh - 220px) * ${width / height})` } : undefined}>
      <div
        ref={boxRef}
        role={interactive ? 'application' : 'img'}
        aria-label={label}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        data-control={interactive ? 'you' : undefined}
        className={cx(
          'computer-screen relative overflow-hidden rounded-lg border border-line bg-surface-2 outline-none select-none',
          interactive && 'cursor-crosshair',
        )}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        {frame && state === 'ready' ? (
          <img src={frame} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full animate-[brot-fade_var(--dur-base)_linear_both] object-cover" />
        ) : null}

        {state === 'ready' && !frame && unavailable === null ? (
          <div className="absolute inset-0 flex flex-col gap-2 p-3" aria-hidden="true">
            <Skeleton height={14} width="60%" />
            <Skeleton shape="block" className="flex-1" />
          </div>
        ) : null}

        {state !== 'ready' || unavailable !== null ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <BotAvatar
              species={avatar.species}
              color={avatar.color}
              mood={state === 'starting' ? 'thinking' : state === 'error' ? 'error' : 'sleeping'}
              size={large ? 64 : 40}
            />
            <p className="m-0 max-w-[30ch] text-sm text-ink-2">
              {state === 'starting'
                ? t('computer.starting', { name: bot.name })
                : state === 'error'
                  ? t('computer.failed')
                  : unavailable === 404
                    ? t('computer.noScreen')
                    : t('computer.stopped', { name: bot.name })}
            </p>
            {state === 'starting' ? <TypingIndicator label={t('computer.state.starting')} /> : null}
            {state === 'stopped' || state === 'error' ? (
              <Button variant="primary" size="sm" disabled={busy} onClick={onStart}>
                <Play size={14} />
                {t('computer.start')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {interactive ? (
          <span className="pointer-events-none absolute top-2 left-2 inline-flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] items-center gap-1.5 rounded-full bg-attention px-2 py-0.5 text-xs font-medium text-[var(--primary-ink)] shadow-float">
            <Hand size={12} />
            {t('computer.youDrive')}
          </span>
        ) : null}
      </div>
      {interactive ? <p className="m-0 text-xs text-ink-3">{t('computer.controlHint')}</p> : null}
      {inputError ? (
        <p role="alert" className="m-0 text-xs text-attention-text">
          {inputError}
        </p>
      ) : null}
    </div>
  );
}
