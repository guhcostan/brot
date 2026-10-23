import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Badge, BotAvatar, Button, Card, EmptyState, Skeleton } from '@brot/ui';
import type { Decision } from '../data/client';

type DecisionOutcome = Decision['decision'];
import { downloadFileUrl } from '../download';
import { avatarOf, formatRelativeTime } from '../format';
import { t, type TranslationKey } from '../i18n';
import { useClient } from './client';
import { useTeam } from './team';

export interface ActivitySectionProps {
  /** Decisions to render before the client load resolves, e.g. in an SSR render. */
  initialDecisions?: Decision[];
}

type Range = '24h' | '7d' | '30d';
type DecisionChoice = 'all' | 'allowed' | 'denied';

const RANGE_HOURS: Record<Range, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

const RANGE_KEY: Record<Range, TranslationKey> = {
  '24h': 'settings.activity24h',
  '7d': 'settings.activity7d',
  '30d': 'settings.activity30d',
};

const OUTCOME_KEY: Record<DecisionOutcome, TranslationKey> = {
  allow_once: 'settings.activityAllowOnce',
  allow_always: 'settings.activityAllowAlways',
  deny: 'settings.activityDeny',
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Activity: the approval audit trail, newest first, with a CSV export of the same window. */
export function ActivitySection({ initialDecisions }: ActivitySectionProps): ReactElement {
  const client = useClient();
  const { bots } = useTeam();
  const [decisions, setDecisions] = useState<Decision[] | null>(initialDecisions ?? null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('7d');
  const [choice, setChoice] = useState<DecisionChoice>('all');
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = new Date(Date.now() - RANGE_HOURS[range] * 3_600_000).toISOString();
    try {
      setDecisions(await client.listDecisions({ from }));
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
      setDecisions((current) => current ?? []);
    }
  }, [client, range]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const visible = (decisions ?? []).filter((decision) => {
    if (choice === 'denied') return decision.decision === 'deny';
    if (choice === 'allowed') return decision.decision !== 'deny';
    return true;
  });

  const download = () => {
    setDownloadError(null);
    const from = new Date(Date.now() - RANGE_HOURS[range] * 3_600_000).toISOString();
    const outcomes: Array<DecisionOutcome | undefined> = choice === 'allowed' ? ['allow_once', 'allow_always'] : choice === 'denied' ? ['deny'] : [undefined];
    let saved = false;
    for (const decision of outcomes) {
      const url = client.decisionsExportUrl({ from, ...(decision === undefined ? {} : { decision }) });
      const name = decision === undefined ? 'brot-decisions.csv' : `brot-decisions-${decision.replace('_', '-')}.csv`;
      if (downloadFileUrl(name, url)) saved = true;
    }
    if (!saved) setDownloadError(t('settings.activityDownloadUnavailable'));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          {t('settings.activityDecision')}
          <select value={choice} onChange={(event) => setChoice(event.target.value as DecisionChoice)} className="brot-input !w-auto !min-h-[30px] !py-1 text-sm">
            <option value="all">{t('settings.activityAll')}</option>
            <option value="allowed">{t('settings.activityAllowed')}</option>
            <option value="denied">{t('settings.activityDenied')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">
          {t('settings.activityRange')}
          <select value={range} onChange={(event) => setRange(event.target.value as Range)} className="brot-input !w-auto !min-h-[30px] !py-1 text-sm">
            {(Object.keys(RANGE_HOURS) as Range[]).map((option) => (
              <option key={option} value={option}>
                {t(RANGE_KEY[option])}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" size="sm" onClick={() => setAttempt((current) => current + 1)}>
          {t('settings.activityRefresh')}
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          {t('settings.activityDownload')}
        </Button>
      </div>

      {downloadError !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {downloadError}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="m-0 text-sm text-attention-text">
          {error}
        </p>
      ) : null}

      {decisions === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} shape="block" height={72} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState title={t('settings.activityEmptyTitle')} description={t('settings.activityEmptyBody')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {visible.map((decision) => {
            const bot = bots[decision.botId];
            const avatar = bot === undefined ? undefined : avatarOf(bot);
            return (
              <li key={decision.id}>
                <Card className="flex items-start gap-3 p-3">
                  {avatar === undefined ? (
                    <span aria-hidden="true" className="size-7 flex-none rounded-full bg-surface-2" />
                  ) : (
                    <BotAvatar shape={avatar.shape} color={avatar.color} mood="idle" size={28} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={decision.decision === 'deny' ? 'attention' : 'neutral'}>{t(OUTCOME_KEY[decision.decision])}</Badge>
                      <span className="text-xs text-ink-2">{bot?.name ?? t('team.unknownBot')}</span>
                      <code className="truncate font-mono text-xs text-ink-3">{decision.tool}</code>
                      <span className="flex-1" />
                      <time className="text-xs text-ink-3" dateTime={decision.decidedAt}>
                        {formatRelativeTime(decision.decidedAt)}
                      </time>
                    </span>
                    <span className="line-clamp-2 text-sm text-ink">{decision.summary}</span>
                    {decision.reply !== undefined ? (
                      <span className="line-clamp-2 text-xs text-ink-2 italic" aria-label={t('settings.activityReply')}>
                        “{decision.reply}”
                      </span>
                    ) : null}
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
