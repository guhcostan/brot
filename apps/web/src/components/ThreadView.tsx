import { useEffect, useRef, type ReactElement } from 'react';
import type { ApprovalDecision, Bot } from '@brot/protocol';
import {
  ApprovalCard,
  BotAvatar,
  Button,
  EmptyState,
  MessageBubble,
  STATUS_MOOD,
  StatusDot,
  ToolCallCard,
  TypingIndicator,
  type BotStatus,
} from '@brot/ui';
import { avatarOf, formatTime, summarizeArgs } from '../format';
import { t } from '../i18n';
import type { ThreadState, TimelineItem } from '../state/thread';
import { Composer } from './Composer';

export interface ThreadViewProps {
  bot: Bot;
  thread: ThreadState;
  status: BotStatus;
  onSend: (content: string) => Promise<void>;
  onDecide: (approvalId: string, decision: ApprovalDecision, reply?: string) => Promise<void>;
  onOpenBots: () => void;
  onOpenContext: () => void;
}

export function ThreadView({
  bot,
  thread,
  status,
  onSend,
  onDecide,
  onOpenBots,
  onOpenContext,
}: ThreadViewProps): ReactElement {
  const logRef = useRef<HTMLDivElement>(null);
  const lastItem = thread.items.at(-1);
  const streaming = lastItem?.kind === 'message' && lastItem.streaming;
  const typing = thread.run === 'running' && !streaming;

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    log.scrollTo({ top: log.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [thread.items.length, lastItem, typing]);

  const avatar = avatarOf(bot);
  const mood = STATUS_MOOD[status];

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <header data-avatar-zone className="titlebar flex h-14 flex-none items-center gap-3 border-b border-line bg-bg px-3 md:px-5">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onOpenBots} aria-label={t('thread.bots')}>
          <ChevronLeft />
        </Button>
        <BotAvatar shape={avatar.shape} color={avatar.color} mood={mood} size={28} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-md leading-tight font-semibold tracking-[var(--tracking-heading)]">{bot.name}</h1>
          <p className="m-0 truncate text-sm text-ink-2">{bot.job}</p>
        </div>
        <StatusDot status={status} className="hidden sm:inline-flex" />
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onOpenContext}>
          {t('thread.context')}
        </Button>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t('thread.log', { name: bot.name })}
        className="min-h-0 flex-1 overflow-y-auto"
      >
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
            thread.items.map((item) => <TimelineEntry key={itemKey(item)} item={item} bot={bot} onDecide={onDecide} />)
          )}
          {typing ? <TypingIndicator label={`${bot.name}: ${t('status.working')}`} className="-mt-2" /> : null}
        </div>
      </div>

      <Composer botName={bot.name} onSend={onSend} />
    </section>
  );
}

function ChevronLeft(): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  );
}

function itemKey(item: TimelineItem): string {
  if (item.kind === 'message') return `m:${item.id}`;
  if (item.kind === 'tool') return `t:${item.callId}`;
  return `a:${item.approval.id}`;
}

interface TimelineEntryProps {
  item: TimelineItem;
  bot: Bot;
  onDecide: (approvalId: string, decision: ApprovalDecision, reply?: string) => Promise<void>;
}

function TimelineEntry({ item, bot, onDecide }: TimelineEntryProps): ReactElement {
  if (item.kind === 'message') {
    const author = item.role === 'assistant' ? bot.name : undefined;
    return (
      <MessageBubble
        role={item.role}
        content={item.content}
        author={author}
        streaming={item.streaming}
        time={item.role === 'system' ? undefined : formatTime(item.at)}
      />
    );
  }

  if (item.kind === 'tool') {
    const summary = summarizeArgs(item.args);
    return (
      <ToolCallCard tool={item.tool} status={item.status} summary={summary || undefined} args={item.args} output={item.output} />
    );
  }

  return (
    <ApprovalCard
      approval={item.approval}
      onDecide={(decision, reply) => {
        void onDecide(item.approval.id, decision, reply);
      }}
    />
  );
}
