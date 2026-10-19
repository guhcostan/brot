import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import type { ApprovalDecision, Bot } from '@brot/protocol';
import { BotAvatar, Button, EmptyState, STATUS_MOOD, StatusDot, TypingIndicator, type BotStatus } from '@brot/ui';
import { avatarOf } from '../format';
import { t } from '../i18n';
import type { ThreadState } from '../state/thread';
import { Composer } from './Composer';
import { botStatusLabel } from './taskLabels';
import { ChevronLeft } from './icons';
import { Timeline } from './Timeline';

export interface ThreadViewProps {
  bot: Bot;
  thread: ThreadState;
  status: BotStatus;
  onSend: (content: string) => Promise<void>;
  onDecide: (approvalId: string, decision: ApprovalDecision, reply?: string) => Promise<void>;
  onOpenBots: () => void;
  onOpenContext: () => void;
}

/** Keeps a log scrolled to the newest entry as it grows. */
export function useStickToBottom(deps: readonly unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const log = ref.current;
    if (!log) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    log.scrollTo({ top: log.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, deps);
  return ref;
}

export function ThreadView({ bot, thread, status, onSend, onDecide, onOpenBots, onOpenContext }: ThreadViewProps): ReactElement {
  const lastItem = thread.items.at(-1);
  const streaming = lastItem?.kind === 'message' && lastItem.streaming;
  const typing = thread.run === 'running' && !streaming;
  const logRef = useStickToBottom([thread.items.length, lastItem, typing]);

  const avatar = avatarOf(bot);
  const mood = STATUS_MOOD[status];

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <PaneHeader onOpenBots={onOpenBots} onOpenContext={onOpenContext}>
        <BotAvatar shape={avatar.shape} color={avatar.color} mood={mood} size={28} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{bot.name}</h1>
          <p className="m-0 truncate text-sm text-ink-2">{bot.job}</p>
        </div>
        <StatusDot status={status} label={botStatusLabel(status)} className="hidden sm:inline-flex" />
      </PaneHeader>

      <div ref={logRef} role="log" aria-live="polite" aria-label={t('thread.log', { name: bot.name })} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-6 px-4 py-8 md:px-6">
          {thread.items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<BotAvatar shape={avatar.shape} color={avatar.color} mood={mood} size="lg" />}
                title={t('thread.emptyTitle', { name: bot.name })}
                description={t('thread.emptyBody', { job: bot.job, name: bot.name })}
              />
            </div>
          ) : (
            <Timeline thread={thread} mode="dm" defaultBotId={bot.id} members={[bot]} onDecide={onDecide} />
          )}
          {typing ? <TypingIndicator label={`${bot.name}: ${t('status.working')}`} className="-mt-2" /> : null}
        </div>
      </div>

      <Composer targetName={bot.name} onSend={(content) => onSend(content)} />
    </section>
  );
}

export function PaneHeader({
  children,
  onOpenBots,
  onOpenContext,
}: {
  children: ReactNode;
  onOpenBots: () => void;
  onOpenContext?: () => void;
}): ReactElement {
  return (
    <header data-avatar-zone className="titlebar flex h-14 flex-none items-center gap-3 border-b border-line bg-bg px-3 md:px-5">
      <Button variant="ghost" size="sm" className="md:hidden" onClick={onOpenBots} aria-label={t('thread.bots')}>
        <ChevronLeft />
      </Button>
      {children}
      {onOpenContext ? (
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onOpenContext}>
          {t('thread.context')}
        </Button>
      ) : null}
    </header>
  );
}
