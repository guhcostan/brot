import { useEffect, useRef, type ReactElement } from 'react';
import type { ApprovalDecision, Bot } from '@brot/protocol';
import { ApprovalCard, Avatar, Button, EmptyState, MessageBubble, StatusDot, ToolCallCard, type BotStatus } from '@brot/ui';
import { faunaOf, formatTime, summarizeArgs } from '../format';
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

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
  }, [thread.items.length, lastItem]);

  const kind = faunaOf(bot);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onOpenBots}>
          {t('thread.bots')}
        </Button>
        <Avatar kind={kind} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-serif text-[length:var(--text-lg)] leading-tight font-semibold">{bot.name}</h1>
          <p className="truncate text-xs text-ink-2">{bot.job}</p>
        </div>
        <StatusDot status={status} />
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onOpenContext}>
          {t('thread.context')}
        </Button>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t('thread.log', { name: bot.name })}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6"
      >
        {thread.items.length === 0 ? (
          <EmptyState
            animal={kind}
            title={t('thread.emptyTitle', { name: bot.name })}
            description={t('thread.emptyBody', { job: bot.job, name: bot.name })}
          />
        ) : (
          thread.items.map((item) => (
            <TimelineEntry key={itemKey(item)} item={item} bot={bot} onDecide={onDecide} />
          ))
        )}
      </div>

      <Composer botName={bot.name} onSend={onSend} />
    </section>
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
    const author = item.role === 'user' ? t('thread.you') : item.role === 'assistant' ? bot.name : undefined;
    return (
      <MessageBubble
        role={item.role}
        content={item.content}
        author={author}
        streaming={item.streaming}
        time={formatTime(item.at)}
      />
    );
  }

  if (item.kind === 'tool') {
    const summary = summarizeArgs(item.args);
    return (
      <ToolCallCard
        tool={item.tool}
        status={item.status}
        summary={summary || undefined}
        args={item.args}
        output={item.output}
      />
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
