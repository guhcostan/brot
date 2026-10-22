import { useEffect, useState, type ReactElement } from 'react';
import type { TodaySummary, UsageGroup, UsageGrouping, UsageSummary } from '@brot/protocol';
import { Button, Card, EmptyState, Skeleton } from '@brot/ui';
import { useClient } from './client';
import { downloadFileUrl } from '../download';
import { formatCount, formatRelativeTime, formatUsd } from '../format';
import { t, type TranslationKey } from '../i18n';
import {
  customUsageWindow,
  formatShortDate,
  formatTokenPair,
  formatUsageDay,
  todayWindow,
  usageWindow,
  type InsightsRange,
  type UsageWindow,
} from '../insights';
import { PaneHeader } from './ThreadView';
import { Chart } from './icons';

export interface InsightsViewProps {
  onOpenBots: () => void;
  /** Jumps to the approvals inbox from the pending-approvals tile. */
  onOpenApprovals: () => void;
  /** Opens a bot's newest thread from a highlight. */
  onOpenBot: (botId: string) => void;
  /** Today summary to render before the client load resolves, e.g. in an SSR render. */
  initialToday?: TodaySummary;
  /** Usage summary to render before the client load resolves, e.g. in an SSR render. */
  initialUsage?: UsageSummary;
  /** Grouping to render before a person toggles it, e.g. in an SSR render. */
  initialGroup?: UsageGrouping;
}

const RANGE_KEY: Record<Exclude<InsightsRange, 'custom'>, TranslationKey> = {
  today: 'insights.rangeToday',
  '7d': 'insights.range7',
  '30d': 'insights.range30',
  '90d': 'insights.range90',
};

const PRESETS: ReadonlyArray<Exclude<InsightsRange, 'custom'>> = ['today', '7d', '30d', '90d'];
const TODAY_PRESETS: ReadonlyArray<Exclude<InsightsRange, 'custom'>> = ['today', '7d', '30d'];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The Insights page: today's runs, routine receipts and highlights, plus usage over a range with a CSV
 * export. One shared window drives both sections; the usage section can widen it to 90 days or a custom range.
 */
export function InsightsView({
  onOpenBots,
  onOpenApprovals,
  onOpenBot,
  initialToday,
  initialUsage,
  initialGroup,
}: InsightsViewProps): ReactElement {
  const client = useClient();
  const [range, setRange] = useState<InsightsRange>('today');
  const [group, setGroup] = useState<UsageGrouping>(initialGroup ?? 'day');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [today, setToday] = useState<TodaySummary | null>(initialToday ?? null);
  const [usage, setUsage] = useState<UsageSummary | null>(initialUsage ?? null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const custom: UsageWindow | undefined = range === 'custom' ? customUsageWindow(customFrom, customTo) : undefined;
  const customInvalid = range === 'custom' && custom === undefined;

  useEffect(() => {
    if (customInvalid) return;
    let active = true;
    setTodayError(null);
    setUsageError(null);
    const now = new Date();
    client
      .getToday(todayWindow(range, now, custom))
      .then((summary) => {
        if (active) setToday(summary);
      })
      .catch((cause: unknown) => {
        if (active) setTodayError(messageOf(cause));
      });
    client
      .getUsage({ ...usageWindow(range, now, custom), group })
      .then((summary) => {
        if (active) setUsage(summary);
      })
      .catch((cause: unknown) => {
        if (active) setUsageError(messageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [client, range, group, customFrom, customTo, attempt, customInvalid, custom]);

  const windowLabel = (summary: { from: string; to: string } | null) =>
    summary === null ? '' : t('insights.window', { from: formatShortDate(summary.from), to: formatShortDate(summary.to) });

  const downloadCsv = () => {
    setDownloadError(null);
    const window = categoryWindow();
    if (window === undefined) return;
    const url = client.usageExportUrl(window);
    if (!downloadFileUrl('brot-usage.csv', url)) setDownloadError(t('insights.downloadUnavailable'));
  };

  /** The window the CSV uses: the same one the usage table was loaded for. */
  const categoryWindow = (): UsageWindow | undefined => {
    if (range === 'custom') return custom;
    return usageWindow(range, new Date());
  };

  const retry = () => {
    setTodayError(null);
    setUsageError(null);
    setAttempt((current) => current + 1);
  };

  const totals = today?.totals;
  const emptyToday = today !== null && totals !== undefined && totals.runs === 0;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots}>
        <span className="flex size-7 flex-none items-center justify-center text-ink">
          <Chart />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{t('insights.title')}</h1>
          <p className="m-0 truncate text-sm text-ink-2">{t('insights.subtitle')}</p>
        </div>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-10 px-4 py-6 md:px-6">
          {todayError !== null || usageError !== null ? (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-attention bg-surface p-3 text-sm text-attention-text">
              {todayError !== null ? <p className="m-0">{t('insights.todayError')}</p> : null}
              {usageError !== null ? <p className="m-0">{t('insights.usageError')}</p> : null}
              <Button variant="secondary" size="sm" onClick={retry}>
                {t('browserPanel.retry')}
              </Button>
            </div>
          ) : null}

          <section className="flex flex-col gap-4" aria-labelledby="insights-today">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 id="insights-today" className="m-0 text-lg font-semibold tracking-[var(--tracking-heading)]">
                  {t('insights.today')}
                </h2>
                {today !== null ? <p className="m-0 text-xs text-ink-3">{windowLabel(today)}</p> : null}
              </div>
              <div role="group" aria-label={t('insights.rangeToday')} className="flex flex-wrap gap-1.5">
                {TODAY_PRESETS.map((preset) => (
                  <Button key={preset} variant={range === preset ? 'secondary' : 'ghost'} size="sm" aria-pressed={range === preset} onClick={() => setRange(preset)}>
                    {t(RANGE_KEY[preset])}
                  </Button>
                ))}
              </div>
            </div>

            {today === null ? (
              todayError === null ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-busy="true" aria-label={t('app.loading')}>
                  {[0, 1, 2, 3, 4, 5].map((key) => (
                    <Skeleton key={key} height={74} shape="block" />
                  ))}
                </div>
              ) : null
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <StatTile label={t('insights.runs')} value={formatCount(today.totals.runs)} />
                  <StatTile label={t('insights.completed')} value={formatCount(today.totals.completed)} />
                  <StatTile label={t('insights.failed')} value={formatCount(today.totals.failed)} />
                  <StatTile label={t('insights.tokens')} value={formatTokenPair(today.totals.tokensIn, today.totals.tokensOut)} />
                  <StatTile label={t('insights.cost')} value={formatUsd(today.totals.costUsd)} />
                  <Card className="flex flex-col gap-1 p-3">
                    <span className="text-xs text-ink-2">{t('insights.pendingApprovals')}</span>
                    <span className="text-lg leading-tight font-semibold tabular-nums">{formatCount(today.pendingApprovals)}</span>
                    <Button variant="ghost" size="sm" onClick={onOpenApprovals} className="self-start !px-0 text-xs">
                      {t('insights.reviewApprovals')}
                    </Button>
                  </Card>
                </div>

                <p className="m-0 text-sm text-ink-2">
                  {today.routines.completed + today.routines.failed + today.routines.skipped + today.routines.running === 0
                    ? t('insights.noRoutines')
                    : t('insights.routines', {
                        completed: String(today.routines.completed),
                        failed: String(today.routines.failed),
                        skipped: String(today.routines.skipped),
                        running: String(today.routines.running),
                      })}
                </p>

                {emptyToday ? (
                  <EmptyState title={t('insights.noRuns')} description={t('insights.noRunsBody')} />
                ) : (
                  <>
                    <h3 className="m-0 text-sm font-medium text-ink-2">{t('insights.byBot')}</h3>
                    <BotTable today={today} />
                    <h3 className="m-0 text-sm font-medium text-ink-2">{t('insights.highlights')}</h3>
                    {today.highlights.length === 0 ? (
                      <p className="m-0 text-sm text-ink-3">{t('insights.noHighlights')}</p>
                    ) : (
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {today.highlights.map((highlight, index) => (
                          <li key={`${highlight.botId}:${highlight.at}:${index}`}>
                            <button
                              type="button"
                              onClick={() => onOpenBot(highlight.botId)}
                              className="flex w-full flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2"
                            >
                              <span className="flex w-full items-baseline justify-between gap-2">
                                <span className="text-sm font-medium text-ink">{highlight.botName}</span>
                                <span className="text-xs text-ink-3">{formatRelativeTime(highlight.at)}</span>
                              </span>
                              <span className="line-clamp-2 text-sm text-ink-2">{highlight.text}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </>
            )}
          </section>

          <section className="flex flex-col gap-4 border-t border-line pt-6" aria-labelledby="insights-usage">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 id="insights-usage" className="m-0 text-lg font-semibold tracking-[var(--tracking-heading)]">
                  {t('insights.usage')}
                </h2>
                {usage !== null ? <p className="m-0 text-xs text-ink-3">{windowLabel(usage)}</p> : null}
              </div>
              <Button variant="secondary" size="sm" onClick={downloadCsv} disabled={customInvalid || usage === null}>
                {t('insights.downloadCsv')}
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="insights-range" className="text-xs font-medium text-ink-2">
                  {t('insights.usage')}
                </label>
                <select
                  id="insights-range"
                  value={range}
                  onChange={(event) => setRange(event.target.value as InsightsRange)}
                  className="brot-input !w-auto !min-h-[30px] !py-1 text-sm"
                >
                  {PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {t(RANGE_KEY[preset])}
                    </option>
                  ))}
                  <option value="custom">{t('insights.custom')}</option>
                </select>
              </div>
              {range === 'custom' ? (
                <>
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                    {t('insights.from')}
                    <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="brot-input !w-auto !min-h-[30px] !py-1 text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
                    {t('insights.to')}
                    <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="brot-input !w-auto !min-h-[30px] !py-1 text-sm" />
                  </label>
                </>
              ) : null}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-2">{t('insights.groupBy')}</span>
                <div role="group" aria-label={t('insights.groupBy')} className="flex gap-1.5">
                  {(['day', 'bot'] as const).map((option) => (
                    <Button key={option} variant={group === option ? 'secondary' : 'ghost'} size="sm" aria-pressed={group === option} onClick={() => setGroup(option)}>
                      {t(option === 'day' ? 'insights.groupDay' : 'insights.groupBot')}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {downloadError !== null ? (
              <p role="alert" className="m-0 text-sm text-attention-text">
                {downloadError}
              </p>
            ) : null}

            {usage === null ? (
              usageError === null ? (
                <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
                  <Skeleton height={32} shape="block" />
                  <Skeleton height={32} shape="block" />
                  <Skeleton height={32} shape="block" />
                </div>
              ) : null
            ) : usage.totals.runs === 0 ? (
              <p className="m-0 text-sm text-ink-3">{t('insights.usageEmpty')}</p>
            ) : (
              <UsageTable usage={usage} grouping={group} />
            )}
          </section>
        </div>
      </div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs text-ink-2">{label}</span>
      <span className="text-lg leading-tight font-semibold tabular-nums">{value}</span>
    </Card>
  );
}

function BotTable({ today }: { today: TodaySummary }): ReactElement {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs text-ink-2">
          <th className="py-2 pr-2 font-medium">{t('insights.bot')}</th>
          <th className="py-2 pr-2 text-right font-medium">{t('insights.runs')}</th>
          <th className="py-2 pr-2 text-right font-medium">{t('insights.completed')}</th>
          <th className="py-2 pr-2 text-right font-medium">{t('insights.failed')}</th>
          <th className="py-2 pr-2 text-right font-medium">{t('insights.tokens')}</th>
          <th className="py-2 text-right font-medium">{t('insights.cost')}</th>
        </tr>
      </thead>
      <tbody>
        {today.byBot.map((bot) => (
          <tr key={bot.botId} className="border-b border-line last:border-0">
            <td className="py-2 pr-2 text-ink">{bot.name}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatCount(bot.runs)}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatCount(bot.completed)}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatCount(bot.failed)}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatTokenPair(bot.tokensIn, bot.tokensOut)}</td>
            <td className="py-2 text-right tabular-nums">{formatUsd(bot.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function groupLabel(group: UsageGroup, grouping: UsageGrouping): string {
  if (group.label !== undefined) return group.label;
  return grouping === 'day' ? formatUsageDay(group.key) : group.key;
}

function UsageTable({ usage, grouping }: { usage: UsageSummary; grouping: UsageGrouping }): ReactElement {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line text-left text-xs text-ink-2">
          <th className="py-2 pr-2 font-medium">{t(grouping === 'day' ? 'insights.groupDay' : 'insights.groupBot')}</th>
          <th className="py-2 pr-2 text-right font-medium">{t('insights.runs')}</th>
          <th className="py-2 pr-2 text-right font-medium">{t('insights.tokens')}</th>
          <th className="py-2 text-right font-medium">{t('insights.cost')}</th>
        </tr>
      </thead>
      <tbody>
        {usage.groups.map((group) => (
          <tr key={group.key} className="border-b border-line">
            <td className="py-2 pr-2 text-ink">{groupLabel(group, grouping)}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatCount(group.totals.runs)}</td>
            <td className="py-2 pr-2 text-right tabular-nums">{formatTokenPair(group.totals.tokensIn, group.totals.tokensOut)}</td>
            <td className="py-2 text-right tabular-nums">{formatUsd(group.totals.costUsd)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="text-ink">
          <td className="py-2 pr-2 font-medium">{t('insights.usageTotals')}</td>
          <td className="py-2 pr-2 text-right font-medium tabular-nums">{formatCount(usage.totals.runs)}</td>
          <td className="py-2 pr-2 text-right font-medium tabular-nums">{formatTokenPair(usage.totals.tokensIn, usage.totals.tokensOut)}</td>
          <td className="py-2 text-right font-medium tabular-nums">{formatUsd(usage.totals.costUsd)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
