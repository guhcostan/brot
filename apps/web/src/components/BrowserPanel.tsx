import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactElement, type WheelEvent } from 'react';
import type { Bot, BrowserTakeover, ComputerInput } from '@brot/protocol';
import { Button, Input, Skeleton } from '@brot/ui';
import { ScreenUnavailable, type BrowserProfileRef } from '../data/client';
import { t } from '../i18n';
import {
  BROWSER_FRAME_MS,
  BROWSER_VIEWPORT_HEIGHT,
  BROWSER_VIEWPORT_WIDTH,
  browserClick,
  browserKey,
  browserScroll,
  isDoubleClick,
  viewportPoint,
  type ClickStamp,
} from './browserLive';
import { useClient } from './client';
import { Dialog } from './Dialog';

export interface BrowserPanelProps {
  open: boolean;
  bot: Bot;
  /** The effective browser profile, when the caller already knows it; a shared one is named. */
  profile?: BrowserProfileRef;
  onClose: () => void;
  /** Takeover state to render before the poll resolves, e.g. in an SSR render. */
  initialTakeover?: BrowserTakeover;
  /** A screen error to render before polling, e.g. in an SSR render. */
  initialUnavailable?: number;
}

const WHEEL_FLUSH_MS = 120;

/** The person's live view of the bot's host browser, with takeover and input. */
export function BrowserPanel({ open, bot, profile, onClose, initialTakeover, initialUnavailable }: BrowserPanelProps): ReactElement {
  return (
    <Dialog
      open={open}
      size="lg"
      title={t('browserPanel.title', { name: bot.name })}
      description={t('browserPanel.description')}
      onClose={onClose}
    >
      {open ? (
        <BrowserLive bot={bot} profile={profile} initialTakeover={initialTakeover} initialUnavailable={initialUnavailable} />
      ) : null}
    </Dialog>
  );
}

function BrowserLive({
  bot,
  profile,
  initialTakeover,
  initialUnavailable,
}: Omit<BrowserPanelProps, 'open' | 'onClose'>): ReactElement {
  const client = useClient();
  const boxRef = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);
  const lastClick = useRef<ClickStamp | undefined>(undefined);
  const wheel = useRef({ dy: 0, x: 0, y: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  const [frame, setFrame] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<number | null>(initialUnavailable ?? null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [takeover, setTakeover] = useState<BrowserTakeover | null>(initialTakeover ?? null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const controlling = takeover?.active === true;

  // Poll while the panel is open and the tab is visible. A 409/404 (no browser, browser not usable) stops it.
  useEffect(() => {
    if (unavailable !== null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const tick = async () => {
      if (stopped) return;
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        controller = new AbortController();
        const [screen, state] = await Promise.allSettled([
          client.browserScreen(bot.id, controller.signal),
          client.getBrowserTakeover(bot.id),
        ]);
        if (stopped) return;
        if (state.status === 'fulfilled') setTakeover(state.value);
        if (screen.status === 'fulfilled') {
          const url = URL.createObjectURL(screen.value);
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
          } catch {
            // A browser that cannot decode still gets the frame; the next poll may replace it.
          }
          if (stopped) {
            URL.revokeObjectURL(url);
            return;
          }
          const previous = shown.current;
          shown.current = url;
          setFrame(url);
          setError(null);
          if (previous !== null) setTimeout(() => URL.revokeObjectURL(previous), 1000);
        } else if (screen.reason instanceof ScreenUnavailable) {
          setUnavailable(screen.reason.status);
          return;
        } else {
          setError(screen.reason instanceof Error ? screen.reason.message : String(screen.reason));
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), BROWSER_FRAME_MS);
    };
    void tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [client, bot.id, unavailable, attempt]);

  useEffect(
    () => () => {
      if (shown.current !== null) URL.revokeObjectURL(shown.current);
      clearTimeout(wheel.current.timer);
    },
    [],
  );

  const send = useCallback(
    async (input: ComputerInput) => {
      if (!controlling) return;
      try {
        await client.browserInput(bot.id, input);
        setActionError(null);
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : String(cause));
        // A refused input often means control changed elsewhere; re-read it instead of guessing.
        void client
          .getBrowserTakeover(bot.id)
          .then(setTakeover)
          .catch(() => undefined);
      }
    },
    [bot.id, client, controlling],
  );

  const toggle = async () => {
    setBusy(true);
    setActionError(null);
    try {
      setTakeover(await client.setBrowserTakeover(bot.id, { active: !controlling }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const pointOf = (event: { clientX: number; clientY: number }) => {
    const rect = boxRef.current?.getBoundingClientRect();
    return rect === undefined ? null : viewportPoint(event.clientX, event.clientY, rect);
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!controlling) return;
    const point = pointOf(event);
    if (point === null) return;
    const now = Date.now();
    const double = isDoubleClick(lastClick.current, point.x, point.y, now);
    lastClick.current = double ? undefined : { at: now, ...point };
    void send(browserClick(point, double));
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!controlling) return;
    const point = pointOf(event);
    if (point === null) return;
    const pending = wheel.current;
    pending.dy += event.deltaY;
    pending.x = point.x;
    pending.y = point.y;
    if (pending.timer !== undefined) return;
    pending.timer = setTimeout(() => {
      const input = browserScroll({ x: pending.x, y: pending.y }, pending.dy);
      pending.dy = 0;
      pending.timer = undefined;
      if (input !== null) void send(input);
    }, WHEEL_FLUSH_MS);
  };

  const submitText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = text.trim();
    if (value === '' || !controlling) return;
    setText('');
    await send({ type: 'type', text: value });
    await send(browserKey('Enter'));
  };

  const retry = () => {
    setUnavailable(null);
    setError(null);
    setFrame(null);
    setAttempt((current) => current + 1);
  };

  const statusLine = controlling ? t('browserPanel.youHaveControl') : t('browserPanel.watching');

  return (
    <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 min-w-0 flex-1 text-sm text-ink-2">{statusLine}</p>
        <Button variant={controlling ? 'secondary' : 'primary'} size="sm" disabled={busy} onClick={() => void toggle()}>
          {controlling ? t('browserPanel.handBack') : t('browserPanel.takeControl')}
        </Button>
      </div>
      {profile?.kind === 'shared' ? <p className="m-0 text-xs text-ink-3">{t('browserPanel.shared', { name: profile.name })}</p> : null}

      <div
        ref={boxRef}
        role={controlling ? 'application' : 'img'}
        aria-label={t('browserPanel.frameAlt', { name: bot.name })}
        tabIndex={controlling ? 0 : undefined}
        onClick={onClick}
        onWheel={onWheel}
        data-control={controlling ? 'you' : undefined}
        className="relative w-full overflow-hidden rounded-lg border border-line bg-surface-2 select-none"
        style={{ aspectRatio: `${BROWSER_VIEWPORT_WIDTH} / ${BROWSER_VIEWPORT_HEIGHT}` }}
      >
        {frame !== null ? (
          <img
            src={frame}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full animate-[brot-fade_var(--dur-base)_linear_both] object-contain"
          />
        ) : unavailable !== null ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-3">
            {t('browserPanel.screenUnavailable')}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col gap-3 p-4" aria-busy="true" aria-label={t('browserPanel.loading')}>
            <Skeleton height="100%" shape="block" />
          </div>
        )}
      </div>

      {unavailable !== null ? (
        <div role="alert" className="flex flex-col items-start gap-1 rounded-md border border-attention bg-surface p-3">
          <p className="m-0 text-sm font-medium text-attention-text">{t('browserPanel.screenUnavailable')}</p>
          <p className="m-0 text-xs text-ink-2">{t('browserPanel.screenUnavailableHint')}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            {t('browserPanel.retry')}
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}
      {actionError !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <form onSubmit={(event) => void submitText(event)} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label={t('browserPanel.typeLabel')}
              hideLabel
              placeholder={t('browserPanel.typePlaceholder')}
              value={text}
              disabled={!controlling}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={!controlling || text.trim() === ''}>
            {t('browserPanel.sendText')}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['Enter', 'browserPanel.keyEnter'],
              ['Escape', 'browserPanel.keyEscape'],
              ['Tab', 'browserPanel.keyTab'],
              ['Backspace', 'browserPanel.keyBackspace'],
            ] as const
          ).map(([key, label]) => (
            <Button key={key} variant="ghost" size="sm" disabled={!controlling} onClick={() => void send(browserKey(key))}>
              {t(label)}
            </Button>
          ))}
        </div>
        <p className="m-0 text-xs text-ink-3">{t('browserPanel.inputHint')}</p>
      </div>
    </div>
  );
}
