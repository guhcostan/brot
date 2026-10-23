import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Bot } from '@brot/protocol';
import { Badge, BotAvatar, Button, EmptyState, Skeleton, cx } from '@brot/ui';
import type { Routine, RoutineRun, RoutineRunStatus, WebhookInfo } from '../data/client';
import { webhookHostname, webhookUrl } from '../webhooks';
import { avatarOf } from '../format';
import { t, type TranslationKey } from '../i18n';
import { describeSchedule, formatRunDuration, relativeNextRun } from '../schedule';
import { useClient } from './client';
import { Clock, Plus, Trash } from './icons';
import { CopyButton } from './CopyButton';
import { RoutineDialog } from './RoutineDialog';
import { ConfirmDialog } from './Dialog';
import { PaneHeader } from './ThreadView';

export interface RoutinesViewProps {
  bots: Bot[];
  onOpenBots: () => void;
  onNewBot: () => void;
  /** Routines to render before the client load resolves, e.g. in an SSR render. */
  initialRoutines?: Routine[];
  /** Run receipts to render before the client load resolves, e.g. in an SSR render. */
  initialRuns?: RoutineRun[];
  /** Webhook receiver info to render before the client load resolves, e.g. in an SSR render. */
  initialWebhookInfo?: WebhookInfo;
}

const RUN_STATUS_KEY: Record<RoutineRunStatus, TranslationKey> = {
  queued: 'routines.run.queued',
  running: 'routines.run.running',
  completed: 'routines.run.completed',
  failed: 'routines.run.failed',
  missed: 'routines.run.missed',
  skipped: 'routines.run.skipped',
  cancelled: 'routines.run.cancelled',
};

const TRIGGER_KEY: Record<RoutineRun['trigger'], TranslationKey> = {
  schedule: 'routines.trigger.schedule',
  manual: 'routines.trigger.manual',
  webhook: 'routines.trigger.webhook',
};

const runTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const toggleIn = (set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A routine's last run status, as a chip that never relies on color alone. */
export function RoutineStatusChip({ status }: { status: RoutineRunStatus }): ReactElement {
  return <Badge tone={status === 'failed' ? 'attention' : 'neutral'}>{t(RUN_STATUS_KEY[status])}</Badge>;
}

/**
 * The Routines page (PRODUCT.md E1): every scheduled instruction, its next run, and its receipts.
 * The data lives here rather than in the app reducer; it is only needed while this pane is open.
 */
export function RoutinesView({ bots, onOpenBots, onNewBot, initialRoutines, initialRuns, initialWebhookInfo }: RoutinesViewProps): ReactElement {
  const client = useClient();
  const [routines, setRoutines] = useState<Routine[] | null>(initialRoutines ?? null);
  const [recentRuns, setRecentRuns] = useState<RoutineRun[]>(initialRuns ?? []);
  const [histories, setHistories] = useState<Record<string, RoutineRun[]>>({});
  const [historyLoading, setHistoryLoading] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<{ routine?: Routine } | null>(null);
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ routineId: string; message: string } | null>(null);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(initialWebhookInfo ?? null);
  const [rotating, setRotating] = useState<Routine | null>(null);
  const filterId = useId();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const load = useCallback(async () => {
    try {
      const [list, runs, hooks] = await Promise.all([client.listRoutines(), client.listRoutineRuns({ limit: 200 }), client.getWebhookInfo().catch(() => ({}))]);
      setRoutines(list);
      setRecentRuns(runs);
      setWebhookInfo(hooks);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setRoutines((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHistory = useCallback(
    async (routineId: string) => {
      setHistoryLoading((current) => new Set(current).add(routineId));
      try {
        const runs = await client.listRoutineRuns({ routineId, limit: 10 });
        setHistories((current) => ({ ...current, [routineId]: runs }));
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setHistoryLoading((current) => toggleIn(current, routineId, false));
      }
    },
    [client],
  );

  const refresh = useCallback(
    async (routineId: string) => {
      setHistories((current) => {
        const next = { ...current };
        delete next[routineId];
        return next;
      });
      await load();
      if (expanded.has(routineId)) await loadHistory(routineId);
    },
    [expanded, load, loadHistory],
  );

  // A live run changes status server-side; keep the chips and expanded history fresh until it settles.
  const watching = recentRuns.some((run) => run.status === 'running' || run.status === 'queued');
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      void load();
      for (const routineId of expanded) void loadHistory(routineId);
    }, 5000);
    return () => clearInterval(timer);
  }, [watching, expanded, load, loadHistory]);

  const lastRunByRoutine = useMemo(() => {
    const latest = new Map<string, RoutineRun>();
    for (const run of recentRuns) if (!latest.has(run.routineId)) latest.set(run.routineId, run);
    return latest;
  }, [recentRuns]);

  const botsById = useMemo(() => Object.fromEntries(bots.map((bot) => [bot.id, bot])), [bots]);
  const schedulableBots = bots.filter((bot) => !bot.archived);
  const visible = useMemo(
    () => (routines ?? []).filter((routine) => filter === '' || routine.botId === filter),
    [routines, filter],
  );

  const nextAt = useMemo(() => {
    const upcoming = visible
      .filter((routine) => routine.enabled && routine.nextRunAt !== undefined)
      .map((routine) => Date.parse(routine.nextRunAt ?? ''))
      .filter((at) => Number.isFinite(at))
      .sort((a, b) => a - b);
    return upcoming[0];
  }, [visible]);
  const nextLabel = relativeNextRun(nextAt === undefined ? undefined : new Date(nextAt).toISOString());
  const enabledCount = visible.filter((routine) => routine.enabled).length;
  const summary = nextLabel
    ? t('routines.summary', { enabled: String(enabledCount), total: String(visible.length), next: t(nextLabel.key, { count: String(nextLabel.count) }) })
    : t('routines.summaryIdle', { enabled: String(enabledCount), total: String(visible.length) });

  const toggleHistory = (routine: Routine) => {
    const open = expanded.has(routine.id);
    setExpanded((current) => toggleIn(current, routine.id, !open));
    if (!open && histories[routine.id] === undefined) void loadHistory(routine.id);
  };

  const toggleEnabled = async (routine: Routine) => {
    setBusyId(routine.id);
    setActionError(null);
    try {
      await client.updateRoutine(routine.id, { enabled: !routine.enabled });
      await refresh(routine.id);
    } catch (cause) {
      setActionError({ routineId: routine.id, message: messageOf(cause) });
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (routine: Routine) => {
    setBusyId(routine.id);
    setActionError(null);
    try {
      await client.runRoutineNow(routine.id);
      // The run starts asynchronously; refresh now and once more when it has had time to begin.
      await refresh(routine.id);
      refreshTimer.current = setTimeout(() => void refresh(routine.id), 1600);
    } catch (cause) {
      setActionError({ routineId: routine.id, message: messageOf(cause) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots}>
        <span className="flex size-7 flex-none items-center justify-center text-ink">
          <Clock />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{t('routines.title')}</h1>
          <p className="m-0 truncate text-sm text-ink-2">{routines === null ? t('app.loading') : summary}</p>
        </div>
        <label htmlFor={filterId} className="brot-sr-only">
          {t('routines.filter')}
        </label>
        <select
          id={filterId}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="brot-input hidden !w-auto !min-h-[30px] !py-1 text-sm sm:block"
        >
          <option value="">{t('board.everyone')}</option>
          {schedulableBots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
        <Button variant="primary" size="sm" onClick={() => setDialog({})} disabled={schedulableBots.length === 0}>
          <Plus size={14} />
          <span className="hidden sm:inline">{t('routines.newRoutine')}</span>
          <span className="brot-sr-only sm:hidden">{t('routines.newRoutine')}</span>
        </Button>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-4 py-6 md:px-6">
          {error ? (
            <p role="alert" className="m-0 rounded-md border border-attention bg-surface px-3 py-2 text-sm text-attention-text">
              {error}
            </p>
          ) : null}

          {routines === null ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('app.loading')}>
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} height={92} shape="block" />
              ))}
            </div>
          ) : routines.length === 0 ? (
            schedulableBots.length === 0 ? (
              <EmptyState
                title={t('routines.noBotsTitle')}
                description={t('routines.noBotsBody')}
                actions={
                  <Button variant="primary" onClick={onNewBot}>
                    <Plus size={16} />
                    {t('sidebar.newBot')}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Clock size={28} />}
                title={t('routines.emptyTitle')}
                description={t('routines.emptyBody')}
                actions={
                  <Button variant="primary" onClick={() => setDialog({})}>
                    <Plus size={16} />
                    {t('routines.newRoutine')}
                  </Button>
                }
              />
            )
          ) : visible.length === 0 ? (
            <p className="m-0 px-1 py-6 text-sm text-ink-2">{t('routines.filterEmpty')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {visible.map((routine) => (
                <li key={routine.id} className="animate-[brot-enter_var(--dur-base)_var(--ease)_both]">
                  <RoutineRow
                    webhookPort={webhookInfo?.port}
                    onRotateWebhook={() => setRotating(routine)}
                    routine={routine}
                    bot={botsById[routine.botId]}
                    lastRun={lastRunByRoutine.get(routine.id)}
                    expanded={expanded.has(routine.id)}
                    history={histories[routine.id]}
                    historyLoading={historyLoading.has(routine.id)}
                    busy={busyId === routine.id}
                    error={actionError?.routineId === routine.id ? actionError.message : undefined}
                    onRunNow={() => void runNow(routine)}
                    onToggleEnabled={() => void toggleEnabled(routine)}
                    onToggleHistory={() => toggleHistory(routine)}
                    onEdit={() => setDialog({ routine })}
                    onDelete={() => setDeleting(routine)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <RoutineDialog
        open={dialog !== null}
        bots={bots}
        routine={dialog?.routine}
        onClose={() => setDialog(null)}
        webhookPort={webhookInfo?.port}
        onRotateWebhook={async (routineId) => {
          const updated = await client.rotateRoutineWebhook(routineId);
          setRoutines((current) => current?.map((entry) => (entry.id === routineId ? updated : entry)) ?? current);
          return updated;
        }}
        onCreate={async (input) => {
          await client.createRoutine(input);
          await load();
        }}
        onUpdate={async (routineId, patch) => {
          await client.updateRoutine(routineId, patch);
          await load();
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('routines.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('routines.deleteBody')}
        confirmLabel={t('routines.delete')}
        tone="danger"
        onConfirm={async () => {
          if (deleting !== null) {
            await client.deleteRoutine(deleting.id);
            setDeleting(null);
            await load();
          }
        }}
        onClose={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={rotating !== null}
        title={t('routines.webhookRotateTitle')}
        description={t('routines.webhookRotateBody')}
        confirmLabel={t('routines.webhookRotateConfirm')}
        tone="danger"
        onConfirm={async () => {
          if (rotating !== null) {
            const updated = await client.rotateRoutineWebhook(rotating.id);
            setRoutines((current) => current?.map((entry) => (entry.id === updated.id ? updated : entry)) ?? current);
            setRotating(null);
          }
        }}
        onClose={() => setRotating(null)}
      />
    </section>
  );
}

/** The webhook chip, URL (or the secret plus a port hint) and its copy/rotate actions. */
function WebhookRow({ secret, port, onRotate, busy }: { secret: string; port: number | undefined; onRotate: () => void; busy: boolean }): ReactElement {
  const url = webhookUrl(webhookHostname(), port, secret);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5">
      <Badge>{t('routines.webhookChip')}</Badge>
      {port === undefined ? (
        <>
          <code className="min-w-0 flex-1 truncate font-mono text-xs" title={t('routines.webhookSecret')}>
            {secret}
          </code>
          <span className="text-xs text-attention-text">{t('routines.webhookPortMissing')}</span>
        </>
      ) : (
        <>
          <code className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>
            {url}
          </code>
          <CopyButton text={url} label={t('routines.webhookCopyUrl')} iconOnly />
        </>
      )}
      <Button variant="ghost" size="sm" onClick={onRotate} disabled={busy}>
        {t('routines.webhookRotate')}
      </Button>
    </div>
  );
}

interface RoutineRowProps {
  routine: Routine;
  /** Undefined when the server did not report the webhook receiver port. */
  webhookPort: number | undefined;
  onRotateWebhook: () => void;
  bot: Bot | undefined;
  lastRun: RoutineRun | undefined;
  expanded: boolean;
  history: RoutineRun[] | undefined;
  historyLoading: boolean;
  busy: boolean;
  error: string | undefined;
  onRunNow: () => void;
  onToggleEnabled: () => void;
  onToggleHistory: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function RoutineRow({ routine, webhookPort, onRotateWebhook, bot, lastRun, expanded, history, historyLoading, busy, error, onRunNow, onToggleEnabled, onToggleHistory, onEdit, onDelete }: RoutineRowProps): ReactElement {
  const name = bot?.name ?? t('team.unknownBot');
  const schedule = describeSchedule(routine.trigger);
  const next = relativeNextRun(routine.nextRunAt);
  const enabledId = useId();
  const avatar = avatarOf(bot ?? { id: routine.botId });

  return (
    <div className={cx('flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 md:p-4', !routine.enabled && 'opacity-80')}>
      <div className="flex items-start gap-3">
        <BotAvatar shape={avatar.shape} color={avatar.color} size={36} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-medium">{routine.name}</span>
            {routine.enabled ? null : <Badge>{t('routines.paused')}</Badge>}
            {lastRun ? (
              <span className="flex items-center gap-1.5 text-xs text-ink-3">
                {t('routines.lastRun')}
                <RoutineStatusChip status={lastRun.status} />
              </span>
            ) : null}
          </div>
          <span className="truncate text-sm text-ink-2">
            {name} · {schedule}
          </span>
          <span className="text-xs text-ink-3">
            {routine.enabled
              ? next !== undefined
                ? t('routines.nextRun', { when: t(next.key, { count: String(next.count) }) })
                : t('routines.nextUnknown')
              : t('routines.pausedHint')}
          </span>
          {routine.trigger.type === 'webhook' ? (
            <WebhookRow
              secret={routine.trigger.secret}
              port={webhookPort}
              onRotate={onRotateWebhook}
              busy={busy}
            />
          ) : null}
        </div>
        <label className="flex flex-none items-center gap-2" htmlFor={enabledId}>
          <span className="brot-sr-only">{t('routines.enabled')}</span>
          <input
            id={enabledId}
            type="checkbox"
            checked={routine.enabled}
            onChange={onToggleEnabled}
            disabled={busy}
            aria-label={t('routines.toggle', { name: routine.name })}
            className="room-check"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onRunNow} disabled={busy}>
          {busy ? t('routines.running') : t('routines.runNow')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggleHistory} aria-expanded={expanded}>
          {t('routines.history')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {t('routines.edit')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} aria-label={t('routines.deleteNamed', { name: routine.name })} title={t('routines.deleteNamed', { name: routine.name })} className="ml-auto text-ink-3">
          <Trash size={15} />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {expanded ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="m-0 text-xs font-medium text-ink-2">{t('routines.history.title')}</h3>
          {historyLoading && history === undefined ? <Skeleton height={40} shape="block" /> : null}
          {history !== undefined && history.length === 0 ? <p className="m-0 text-sm text-ink-3">{t('routines.history.empty')}</p> : null}
          {history !== undefined && history.length > 0 ? (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {history.map((run) => {
                const duration = formatRunDuration(run.startedAt, run.endedAt);
                return (
                  <li key={run.id} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <RoutineStatusChip status={run.status} />
                      <time className="text-xs text-ink-3 tabular-nums" dateTime={run.startedAt}>
                        {runTimeFormat.format(new Date(run.startedAt))}
                      </time>
                      <span className="text-xs text-ink-3">{t(TRIGGER_KEY[run.trigger])}</span>
                      {duration !== undefined ? <span className="text-xs text-ink-3">{duration}</span> : null}
                    </div>
                    {run.result ? <p className="m-0 line-clamp-3 text-sm whitespace-pre-wrap text-ink-2">{run.result}</p> : null}
                    {run.error ? <p className="m-0 text-sm text-attention-text">{run.error}</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
