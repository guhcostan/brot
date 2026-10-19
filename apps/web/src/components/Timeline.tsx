import type { ReactElement, ReactNode } from 'react';
import type { ApprovalDecision } from '@brot/protocol';
import { ApprovalCard, MessageBubble, StatusDot, TaskStatusLabel, ToolCallCard, TypingIndicator } from '@brot/ui';
import { formatTime, summarizeArgs } from '../format';
import { t } from '../i18n';
import { splitMentions, type Mentionable } from '../mentions';
import {
  botActivity,
  gazeTargets,
  type ExchangeItem,
  type HandoffItem,
  type MessageItem,
  type TaskRefItem,
  type ThreadState,
  type TimelineItem,
} from '../state/thread';
import { taskStatusLabel } from './taskLabels';
import { ArrowRight, Baton } from './icons';
import { TeamAvatar, moodOf, useBotName, useTeam } from './team';

export interface TimelineProps {
  thread: ThreadState;
  /** Rooms show each bot's avatar on its turns. A DM names the bot only. */
  mode: 'dm' | 'room';
  /** The DM's bot, the author of assistant messages that name none. */
  defaultBotId?: string;
  /** Who can be @mentioned, for mention chips. */
  members: readonly Mentionable[];
  onDecide: (approvalId: string, decision: ApprovalDecision, reply?: string) => Promise<void>;
}

type Block =
  | { kind: 'turn'; botId: string | undefined; messages: MessageItem[] }
  | { kind: 'item'; item: TimelineItem };

/** Consecutive assistant messages by the same bot form one turn, so the name and avatar show once. */
export function toBlocks(items: readonly TimelineItem[], defaultBotId?: string): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === 'message' && item.role === 'assistant' && item.viaBotId === undefined) {
      const botId = item.authorBotId ?? defaultBotId;
      const last = blocks.at(-1);
      if (last?.kind === 'turn' && last.botId === botId) {
        last.messages.push(item);
        continue;
      }
      blocks.push({ kind: 'turn', botId, messages: [item] });
      continue;
    }
    blocks.push({ kind: 'item', item });
  }
  return blocks;
}

function blockKey(block: Block): string {
  if (block.kind === 'turn') return `turn:${block.messages[0]?.id ?? ''}`;
  const { item } = block;
  switch (item.kind) {
    case 'message':
      return `m:${item.id}`;
    case 'tool':
      return `t:${item.callId}`;
    case 'approval':
      return `a:${item.approval.id}`;
    case 'exchange':
      return `x:${item.askId}`;
    case 'handoff':
      return `h:${item.id}`;
    case 'task':
      return `k:${item.taskId}`;
  }
}

export function Timeline({ thread, mode, defaultBotId, members, onDecide }: TimelineProps): ReactElement {
  const renderText = (text: string): ReactNode => <MentionText text={text} members={members} />;
  const gazes = gazeTargets(thread);
  return (
    <>
      {toBlocks(thread.items, defaultBotId).map((block) => {
        const key = blockKey(block);
        if (block.kind === 'turn') {
          return <BotTurn key={key} botId={block.botId} messages={block.messages} mode={mode} renderText={renderText} thread={thread} />;
        }
        const { item } = block;
        switch (item.kind) {
          case 'message':
            if (item.viaBotId !== undefined) return <ViaRow key={key} item={item} renderText={renderText} />;
            return (
              <MessageBubble
                key={key}
                role={item.role}
                content={item.content}
                streaming={item.streaming}
                time={item.role === 'system' ? undefined : formatTime(item.at)}
                renderText={renderText}
              />
            );
          case 'tool':
            return (
              <ToolCallCard
                key={key}
                tool={item.tool}
                status={item.status}
                summary={summarizeArgs(item.args) || undefined}
                args={item.args}
                output={item.output}
              />
            );
          case 'approval':
            return (
              <ApprovalCard
                key={key}
                approval={item.approval}
                onDecide={(decision, reply) => {
                  void onDecide(item.approval.id, decision, reply);
                }}
              />
            );
          case 'exchange':
            return <ExchangeRow key={key} item={item} thread={thread} looking={gazes[item.fromBotId] === item.toBotId} renderText={renderText} />;
          case 'handoff':
            return <HandoffRow key={key} item={item} />;
          case 'task':
            return <TaskRow key={key} item={item} />;
        }
      })}
    </>
  );
}

/** `@Name` mentions of members as quiet chips: weight and a neutral fill, no color. */
export function MentionText({ text, members }: { text: string; members: readonly Mentionable[] }): ReactElement {
  return (
    <>
      {splitMentions(text, members).map((part, index) =>
        part.kind === 'mention' ? (
          <span key={index} className="mention-chip">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

interface BotTurnProps {
  botId: string | undefined;
  messages: MessageItem[];
  mode: 'dm' | 'room';
  thread: ThreadState;
  renderText: (text: string) => ReactNode;
}

function BotTurn({ botId, messages, mode, thread, renderText }: BotTurnProps): ReactElement {
  const nameOf = useBotName();
  const name = nameOf(botId);
  if (mode === 'dm' || botId === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            role="assistant"
            content={message.content}
            author={index === 0 ? name : undefined}
            time={index === 0 ? formatTime(message.at) : undefined}
            streaming={message.streaming}
            renderText={renderText}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-3" data-avatar-zone>
      <div className="flex w-7 flex-none justify-center pt-0.5">
        <TeamAvatar botId={botId} size={26} mood={moodOf(botActivity(thread, botId))} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            role="assistant"
            content={message.content}
            author={index === 0 ? name : undefined}
            time={index === 0 ? formatTime(message.at) : undefined}
            streaming={message.streaming}
            renderText={renderText}
          />
        ))}
      </div>
    </div>
  );
}

function Pair({ from, to, fromMood, toMood, looking }: { from: string; to: string; fromMood?: 'idle' | 'thinking'; toMood?: 'idle' | 'thinking'; looking?: boolean }): ReactElement {
  return (
    <span className="flex flex-none items-center gap-1 text-ink-3">
      <TeamAvatar botId={from} size={20} mood={fromMood} gaze={looking ? 'right' : undefined} />
      <ArrowRight />
      <TeamAvatar botId={to} size={20} mood={toMood} />
    </span>
  );
}

interface ExchangeRowProps {
  item: ExchangeItem;
  thread: ThreadState;
  /** The asker is still waiting on this answer, so its eyes look toward the answering bot. */
  looking: boolean;
  renderText: (text: string) => ReactNode;
}

/** One `ask_bot` exchange, collapsed to a single quiet line. Native details/summary keeps it keyboard-accessible. */
function ExchangeRow({ item, thread, looking, renderText }: ExchangeRowProps): ReactElement {
  const nameOf = useBotName();
  const from = nameOf(item.fromBotId);
  const to = nameOf(item.toBotId);
  const answered = item.answer !== undefined;
  const title = t('team.asked', { from, to });
  const state = answered ? t('team.answered') : t('team.waitingAnswer', { name: to });
  const preview = item.question || item.answer || '';
  const answering = !answered && botActivity(thread, item.toBotId) !== 'idle';
  return (
    <details className="exchange" data-avatar-zone>
      <summary aria-label={`${title}. ${state}. ${preview}`}>
        <Pair from={item.fromBotId} to={item.toBotId} looking={looking} toMood={answering ? 'thinking' : undefined} />
        <span className="flex-none font-medium text-ink">{title}</span>
        <span className="min-w-0 flex-1 truncate text-ink-2">{preview}</span>
        <span className="hidden flex-none items-center gap-1.5 text-ink-3 sm:inline-flex">
          {answered ? <span>{state}</span> : <TypingIndicator label={state} />}
        </span>
      </summary>
      <div className="exchange__body">
        {item.question ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-ink-2">{t('team.question', { name: from })}</span>
            <p className="m-0 whitespace-pre-wrap">{renderText(item.question)}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-ink-2">{t('team.answer', { name: to })}</span>
          {answered ? (
            <p className="m-0 whitespace-pre-wrap">{renderText(item.answer ?? '')}</p>
          ) : (
            <p className="m-0 text-ink-3">{state}</p>
          )}
        </div>
        <time className="text-xs text-ink-3 tabular-nums">{formatTime(item.answeredAt ?? item.at)}</time>
      </div>
    </details>
  );
}

/** A message one bot addressed to another, e.g. the brief a task starts with. */
function ViaRow({ item, renderText }: { item: MessageItem; renderText: (text: string) => ReactNode }): ReactElement {
  const nameOf = useBotName();
  const from = item.authorBotId ?? '';
  const to = item.viaBotId ?? '';
  const title = t('team.wrote', { from: nameOf(from), to: nameOf(to) });
  return (
    <details className="exchange" data-avatar-zone>
      <summary aria-label={`${title}. ${item.content}`}>
        <Pair from={from} to={to} />
        <span className="flex-none font-medium text-ink">{title}</span>
        <span className="min-w-0 flex-1 truncate text-ink-2">{item.content}</span>
        <time className="flex-none text-xs text-ink-3 tabular-nums">{formatTime(item.at)}</time>
      </summary>
      <div className="exchange__body">
        <p className="m-0 whitespace-pre-wrap">{renderText(item.content)}</p>
      </div>
    </details>
  );
}

/** The baton pass: quiet, centered, no card. */
function HandoffRow({ item }: { item: HandoffItem }): ReactElement {
  const nameOf = useBotName();
  const text = t('team.handoff', { from: nameOf(item.fromBotId), to: nameOf(item.toBotId) });
  return (
    <div className="flex min-w-0 items-center justify-center gap-2 text-xs text-ink-2" role="note">
      <span className="hidden h-px min-w-6 flex-1 bg-line sm:block" aria-hidden="true" />
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="flex-none text-ink-3">
          <Baton />
        </span>
        <TeamAvatar botId={item.fromBotId} size={16} className="flex-none" />
        <span className="flex-none font-medium whitespace-nowrap text-ink">{text}</span>
        <TeamAvatar botId={item.toBotId} size={16} className="flex-none" />
        {item.note ? <span className="min-w-0 truncate">{item.note}</span> : null}
        <time className="flex-none text-ink-3 tabular-nums">{formatTime(item.at)}</time>
      </span>
      <span className="hidden h-px min-w-6 flex-1 bg-line sm:block" aria-hidden="true" />
    </div>
  );
}

/** A task created from this thread, with its live status from the task store. */
function TaskRow({ item }: { item: TaskRefItem }): ReactElement | null {
  const { tasks, openTask } = useTeam();
  const nameOf = useBotName();
  const task = tasks[item.taskId];
  if (!task) return null;
  const assignee = nameOf(task.assigneeBotId);
  const lead = task.createdByBotId
    ? t('team.delegated', { from: nameOf(task.createdByBotId), to: assignee })
    : t('team.youAssigned', { to: assignee });
  return (
    <button
      type="button"
      onClick={() => openTask(task.id)}
      className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm transition-colors duration-[var(--dur-fast)] hover:bg-surface-2"
    >
      <TeamAvatar botId={task.assigneeBotId} size={20} mood={task.status === 'in_progress' ? 'thinking' : undefined} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs text-ink-2">{lead}</span>
        <span className="truncate font-medium text-ink">{task.title}</span>
      </span>
      <TaskStatusLabel status={task.status} label={taskStatusLabel(task.status)} />
    </button>
  );
}

/** "Onça is working" lines for bots running in this thread that are not streaming text yet. */
export function WorkingBots({ thread }: { thread: ThreadState }): ReactElement | null {
  const nameOf = useBotName();
  const streaming = new Set(
    thread.items.flatMap((item) => (item.kind === 'message' && item.streaming && item.authorBotId ? [item.authorBotId] : [])),
  );
  const working = [
    ...new Set(
      Object.values(thread.activeRuns).flatMap((run) =>
        run.state === 'running' && run.botId !== undefined && !streaming.has(run.botId) ? [run.botId] : [],
      ),
    ),
  ];
  const waiting = [
    ...new Set(Object.values(thread.activeRuns).flatMap((run) => (run.state === 'waiting_approval' && run.botId ? [run.botId] : []))),
  ];
  if (working.length === 0 && waiting.length === 0) return null;
  return (
    <div className="-mt-2 flex flex-col gap-2">
      {working.map((botId) => (
        <div key={botId} className="flex items-center gap-3 text-sm text-ink-2">
          <span className="flex w-7 justify-center">
            <TeamAvatar botId={botId} size={20} mood="thinking" />
          </span>
          <span aria-hidden="true" className="inline-flex">
            <TypingIndicator label="" />
          </span>
          <span role="status">{t('team.working', { name: nameOf(botId) })}</span>
        </div>
      ))}
      {waiting.map((botId) => (
        <div key={botId} className="flex items-center gap-3 text-sm">
          <span className="flex w-7 justify-center">
            <TeamAvatar botId={botId} size={20} mood="approval" />
          </span>
          <StatusDot status="waiting" label={t('team.waitingYou', { name: nameOf(botId) })} />
        </div>
      ))}
    </div>
  );
}
