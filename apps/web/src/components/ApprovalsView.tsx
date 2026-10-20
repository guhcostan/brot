import { useState, type ReactElement } from 'react';
import type { ApprovalDecision } from '@brot/protocol';
import { ApprovalCard, BotAvatar, EmptyState, cx } from '@brot/ui';
import { formatTime } from '../format';
import { t } from '../i18n';
import type { InboxEntry } from '../state/store';
import { approvalLabels } from './approvalLabels';
import { TeamAvatar, useBotName, useTeam } from './team';
import { PaneHeader } from './ThreadView';

export interface ApprovalsViewProps {
  entries: InboxEntry[];
  onDecide: (approvalId: string, decision: ApprovalDecision, reply?: string) => Promise<void>;
  onOpenBots: () => void;
}

/** Every action waiting for you, across bots and rooms. Cards rise in, and leave once decided. */
export function ApprovalsView({ entries, onDecide, onOpenBots }: ApprovalsViewProps): ReactElement {
  const { rooms, openBot, openRoom } = useTeam();
  const nameOf = useBotName();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labels = approvalLabels();

  const decide = async (approvalId: string, decision: ApprovalDecision, reply?: string) => {
    setBusy(approvalId);
    setError(null);
    try {
      await onDecide(approvalId, decision, reply);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots}>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{t('approvals.title')}</h1>
          <p className="m-0 truncate text-sm text-ink-2">
            {entries.length === 0 ? t('approvals.summaryNone') : t(entries.length === 1 ? 'approvals.summaryOne' : 'approvals.summaryMany', { count: String(entries.length) })}
          </p>
        </div>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-5 px-4 py-8 md:px-6">
          {error ? (
            <p role="alert" className="m-0 text-sm text-attention-text">
              {error}
            </p>
          ) : null}
          {entries.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<BotAvatar species="capivara" color="black" mood="success" size="lg" />}
                title={t('approvals.emptyTitle')}
                description={t('approvals.emptyBody')}
              />
            </div>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-5 p-0">
              {entries.map(({ approval, roomId }) => {
                const room = roomId ? rooms.find((entry) => entry.thread.id === roomId) : undefined;
                const where = room ? t('approvals.inRoom', { title: room.thread.title }) : t('approvals.inDm');
                return (
                  <li key={approval.id} className="flex flex-col gap-2">
                    <div data-avatar-zone className="flex items-center gap-2.5">
                      <TeamAvatar botId={approval.botId} size={26} mood="approval" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-semibold">{t('approvals.asks', { name: nameOf(approval.botId) })}</span>
                        <span className="truncate text-xs text-ink-2">
                          {where} · <time className="tabular-nums">{formatTime(approval.createdAt)}</time>
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => (roomId ? openRoom(roomId) : openBot(approval.botId))}
                        className="flex-none rounded-md px-2 py-1 text-xs text-ink-2 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink"
                      >
                        {t('approvals.open')}
                      </button>
                    </div>
                    <ApprovalCard
                      approval={approval}
                      labels={labels}
                      busy={busy === approval.id}
                      className={cx(busy === approval.id && 'opacity-60')}
                      onDecide={(decision, reply) => void decide(approval.id, decision, reply)}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
