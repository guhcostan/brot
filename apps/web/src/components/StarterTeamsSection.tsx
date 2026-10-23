import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Button, Card, EmptyState, Skeleton } from '@brot/ui';
import type { StarterTeamInstallCounts, StarterTeamSummary } from '../data/client';
import { t } from '../i18n';
import { useClient } from './client';

export interface StarterTeamsSectionProps {
  /** Starters to render before the client load resolves, e.g. in an SSR render. */
  initialStarters?: StarterTeamSummary[];
  /** Called after a successful install so the app can refresh bots and teams. */
  onInstalled?: () => Promise<unknown> | unknown;
  /** Results to render before any click, for SSR previews and tests. */
  initialResults?: Record<string, StarterResult>;
}

export type StarterResult = { counts: StarterTeamInstallCounts } | { error: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Settings → Starter teams: ready-made teams installed as normal, editable workspace objects. */
export function StarterTeamsSection({ initialStarters, onInstalled, initialResults }: StarterTeamsSectionProps): ReactElement {
  const client = useClient();
  const [starters, setStarters] = useState<StarterTeamSummary[] | null>(initialStarters ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, StarterResult>>(initialResults ?? {});

  const load = useCallback(async () => {
    try {
      setStarters(await client.listStarterTeams());
      setLoadError(null);
    } catch (cause) {
      setLoadError(messageOf(cause));
      setStarters((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const install = async (starter: StarterTeamSummary) => {
    if (installing !== null) return;
    setInstalling(starter.id);
    setResults((current) => {
      const next = { ...current };
      delete next[starter.id];
      return next;
    });
    try {
      const counts = await client.installStarterTeam(starter.id);
      setResults((current) => ({ ...current, [starter.id]: { counts } }));
      await onInstalled?.();
    } catch (cause) {
      setResults((current) => ({ ...current, [starter.id]: { error: messageOf(cause) } }));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {loadError !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="m-0 text-sm text-attention-text">
            {loadError}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((current) => current + 1)}>
            {t('settings.starterRetry')}
          </Button>
        </div>
      ) : null}

      {starters === null ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('app.loading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} shape="block" height={96} />
          ))}
        </div>
      ) : starters.length === 0 ? (
        <EmptyState title={t('settings.starterEmptyTitle')} description={t('settings.starterEmptyBody')} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
          {starters.map((starter) => {
            const result = results[starter.id];
            const busy = installing === starter.id;
            return (
              <li key={starter.id}>
                <Card className="flex h-full flex-col gap-2 p-3">
                  <span className="text-sm font-medium">{starter.name}</span>
                  <span className="text-xs text-ink-2">{starter.description}</span>
                  <span className="text-xs text-ink-3">
                    {t('settings.starterCounts', {
                      bots: String(starter.botCount),
                      rooms: String(starter.roomCount),
                      routines: String(starter.routineCount),
                      skills: String(starter.skillCount),
                    })}
                  </span>
                  {result !== undefined && 'counts' in result ? (
                    <p role="status" className="m-0 text-xs text-ink-2">
                      {t('settings.starterInstalled', {
                        bots: String(result.counts.bots),
                        teams: String(result.counts.teams),
                        rooms: String(result.counts.rooms),
                      })}
                    </p>
                  ) : null}
                  {result !== undefined && 'error' in result ? (
                    <p role="alert" className="m-0 text-xs text-attention-text">
                      {result.error}
                    </p>
                  ) : null}
                  <span className="flex-1" />
                  <Button variant="secondary" size="sm" className="self-start" disabled={busy || installing !== null} onClick={() => void install(starter)}>
                    {busy ? t('settings.starterInstalling') : t('settings.starterInstall')}
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
