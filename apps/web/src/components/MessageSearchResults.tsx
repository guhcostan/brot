import { useState, type ReactElement } from 'react';
import type { Bot, SearchHit } from '@brot/protocol';
import { BotAvatar, Button, Skeleton } from '@brot/ui';
import { avatarOf, formatRelativeTime } from '../format';
import { t } from '../i18n';
import { MESSAGE_SEARCH_VISIBLE, visibleSearchHits } from '../search';

export interface MessageSearchResultsProps {
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
  /** Bots available for avatars; a hit whose bot is gone renders without one. */
  bots: Bot[];
  onOpenHit: (hit: SearchHit) => void;
  /** Rows shown before the "show all" expander. */
  visibleLimit?: number;
  /** Start expanded, e.g. in an SSR render. */
  initialExpanded?: boolean;
}

/** Global message hits shown under the sidebar's filtered bots and rooms. Snippets are plain text. */
export function MessageSearchResults({
  hits,
  loading,
  error,
  bots,
  onOpenHit,
  visibleLimit = MESSAGE_SEARCH_VISIBLE,
  initialExpanded = false,
}: MessageSearchResultsProps): ReactElement {
  const [expanded, setExpanded] = useState(initialExpanded);
  const shown = visibleSearchHits(hits, expanded, visibleLimit);
  const botById = new Map(bots.map((bot) => [bot.id, bot]));

  return (
    <section className="flex flex-col gap-1" aria-labelledby="sidebar-messages">
      <h2 id="sidebar-messages" className="m-0 px-2 pb-1 text-xs font-medium text-ink-3">
        {t('sidebar.messages')}
      </h2>
      {loading ? (
        <div className="flex flex-col gap-1.5 px-2 py-1" aria-busy="true" aria-label={t('sidebar.messagesLoading')}>
          {[0, 1].map((key) => (
            <Skeleton key={key} height={46} shape="block" />
          ))}
        </div>
      ) : error !== null ? (
        <p role="alert" className="m-0 px-2 py-1 text-sm text-attention-text">
          {t('sidebar.messagesError', { message: error })}
        </p>
      ) : hits.length === 0 ? (
        <p className="m-0 px-2 py-1 text-sm text-ink-3">{t('sidebar.messagesEmpty')}</p>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {shown.map((hit) => {
              const bot = hit.botId === undefined ? undefined : botById.get(hit.botId);
              const avatar = bot === undefined ? undefined : avatarOf(bot);
              return (
                <li key={hit.messageId}>
                  <button
                    type="button"
                    data-avatar-zone
                    onClick={() => onOpenHit(hit)}
                    className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2"
                  >
                    <span className="flex w-6 flex-none justify-center pt-0.5">
                      {avatar === undefined ? (
                        <span aria-hidden="true" className="size-6 rounded-full bg-surface-2" />
                      ) : (
                        <BotAvatar species={avatar.species} color={avatar.color} mood="idle" size={24} />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-ink">{hit.threadTitle}</span>
                        {hit.botName !== undefined ? <span className="flex-none truncate text-xs text-ink-3">{hit.botName}</span> : null}
                      </span>
                      <span className="line-clamp-2 break-words text-xs text-ink-2">{hit.snippet}</span>
                      <span className="text-xs text-ink-3 tabular-nums">{formatRelativeTime(hit.createdAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {hits.length > visibleLimit ? (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((current) => !current)} className="self-start text-xs text-ink-2">
              {expanded
                ? t('sidebar.showFewerResults')
                : t('sidebar.showAllResults', { count: String(hits.length) })}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
