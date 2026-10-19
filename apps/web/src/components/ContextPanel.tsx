import { useId, useState, type ReactElement } from 'react';
import type { Bot, Task } from '@brot/protocol';
import { Badge, BotAvatar, Button, Card, EmptyState, cx } from '@brot/ui';
import type { Room } from '../data/client';
import { avatarOf, formatCount, formatTime, formatUsd } from '../format';
import { t, type TranslationKey } from '../i18n';
import { botActivity, sumCost, type ThreadState } from '../state/thread';
import { Plus } from './icons';
import { TaskList } from './Tasks';
import { moodOf } from './team';

const BOT_TABS = ['memory', 'tasks', 'skills', 'apps', 'routines', 'cost'] as const;
const ROOM_TABS = ['tasks', 'cost'] as const;
type TabId = (typeof BOT_TABS)[number];

const TAB_LABEL: Record<TabId, TranslationKey> = {
  memory: 'context.memory',
  tasks: 'context.tasks',
  skills: 'context.skills',
  apps: 'context.apps',
  routines: 'context.routines',
  cost: 'context.cost',
};

export type ContextSubject = { kind: 'bot'; bot: Bot } | { kind: 'room'; room: Room; members: Bot[] };

export interface ContextPanelProps {
  subject: ContextSubject;
  thread: ThreadState;
  /** Tasks for this bot or room, newest first. */
  tasks: Task[];
  onNewTask: () => void;
  onClose: () => void;
  className?: string;
}

/**
 * A bot's computer on top, or a room's members, then text tabs with an underline (DESIGN.md
 * section 7).
 */
export function ContextPanel({ subject, thread, tasks, onNewTask, onClose, className }: ContextPanelProps): ReactElement {
  const tabs: readonly TabId[] = subject.kind === 'bot' ? BOT_TABS : ROOM_TABS;
  const [chosen, setTab] = useState<TabId>(subject.kind === 'bot' ? 'memory' : 'tasks');
  const tab = tabs.includes(chosen) ? chosen : tabs[0]!;
  const idBase = useId();

  return (
    <aside className={cx('flex min-h-0 flex-col bg-surface md:border-l md:border-line', className)}>
      <div className="titlebar flex h-14 flex-none items-center justify-between gap-2 border-b border-line px-4 mac-shell:pl-20 md:mac-shell:pl-4">
        <h2 className="m-0 text-base font-semibold tracking-[var(--tracking-heading)]">
          {subject.kind === 'bot' ? t('context.computer') : t('context.members')}
        </h2>
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onClose}>
          {t('context.close')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {subject.kind === 'bot' ? <Computer bot={subject.bot} /> : <Members room={subject.room} members={subject.members} thread={thread} />}

        <div
          role="tablist"
          aria-label={t('context.tablist')}
          className="no-scrollbar sticky top-0 z-10 flex gap-4 overflow-x-auto border-b border-line bg-surface px-4"
        >
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${idBase}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${idBase}-panel`}
              onClick={() => setTab(id)}
              className={cx(
                '-mb-px flex-none border-b-2 py-3 text-sm font-medium transition-colors duration-[var(--dur-fast)]',
                tab === id ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink',
              )}
            >
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${tab}`} className="p-4">
          {tab === 'tasks' ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 text-sm font-medium text-ink-2">
                  {subject.kind === 'bot' ? t('context.tasksBot', { name: subject.bot.name }) : t('context.tasksRoom')}
                </h3>
                <Button variant="secondary" size="sm" onClick={onNewTask}>
                  <Plus size={14} />
                  {t('board.newTask')}
                </Button>
              </div>
              <TaskList tasks={tasks} empty={subject.kind === 'bot' ? t('context.tasksEmptyBot', { name: subject.bot.name }) : t('context.tasksEmptyRoom')} />
            </div>
          ) : (
            <TabBody tab={tab} name={subject.kind === 'bot' ? subject.bot.name : subject.room.thread.title} thread={thread} />
          )}
        </div>
      </div>
    </aside>
  );
}

function Computer({ bot }: { bot: Bot }): ReactElement {
  const name = bot.name;
  const avatar = avatarOf(bot);
  if (bot.computer === 'none') {
    return (
      <div className="flex flex-col gap-1 border-b border-line p-4">
        <p className="m-0 text-base font-medium">{t('context.noComputerTitle')}</p>
        <p className="m-0 text-sm text-ink-2">{t('context.noComputerBody', { name })}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 border-b border-line p-4">
      <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface-2 p-4 text-center">
        <BotAvatar shape={avatar.shape} color={avatar.color} mood="sleeping" size="md" />
        <p className="m-0 max-w-[30ch] text-sm text-ink-2">{t('context.computerBody', { name })}</p>
      </div>
      <p className="m-0 text-sm font-medium">{t('context.computerTitle')}</p>
    </div>
  );
}

function Members({ room, members, thread }: { room: Room; members: Bot[]; thread: ThreadState }): ReactElement {
  return (
    <div className="flex flex-col gap-1 border-b border-line p-3">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {members.map((bot) => {
          const avatar = avatarOf(bot);
          const activity = botActivity(thread, bot.id);
          return (
            <li key={bot.id} data-avatar-zone className="flex items-center gap-3 rounded-md px-1 py-1.5">
              <BotAvatar shape={avatar.shape} color={avatar.color} mood={moodOf(activity)} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{bot.name}</span>
                <span className="truncate text-xs text-ink-2">{activity === 'idle' ? bot.job : t(activity === 'waiting' ? 'status.waiting' : 'status.working')}</span>
              </span>
              {bot.id === room.thread.leadBotId ? <Badge>{t('room.lead')}</Badge> : null}
              {bot.id === thread.baton && bot.id !== room.thread.leadBotId ? <Badge>{t('room.next')}</Badge> : null}
            </li>
          );
        })}
      </ul>
      <p className="m-0 px-1 pt-1 text-xs text-ink-2">
        {room.thread.responder === 'mention' ? t('room.ruleMention') : t('room.ruleLeadShort')}
      </p>
    </div>
  );
}

function TabBody({ tab, name, thread }: { tab: Exclude<TabId, 'tasks'>; name: string; thread: ThreadState }): ReactElement {

  switch (tab) {
    case 'memory':
      if (thread.memories.length === 0) {
        return <EmptyState className="py-8" title={t('context.memoryTitle')} description={t('context.memoryBody', { name })} />;
      }
      return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {thread.memories.map((memory) => (
            <li key={memory.id}>
              <Card className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge>{memory.kind}</Badge>
                  <span className="text-xs text-ink-3 tabular-nums">{formatTime(memory.updatedAt)}</span>
                </div>
                <p className="m-0 text-base">{memory.content}</p>
              </Card>
            </li>
          ))}
        </ul>
      );

    case 'skills':
      return <EmptyState className="py-8" title={t('context.skillsTitle')} description={t('context.skillsBody', { name })} />;

    case 'apps':
      return <EmptyState className="py-8" title={t('context.appsTitle')} description={t('context.appsBody')} />;

    case 'routines':
      return <EmptyState className="py-8" title={t('context.routinesTitle')} description={t('context.routinesBody', { name })} />;

    case 'cost': {
      const total = sumCost(thread);
      return (
        <div className="flex flex-col gap-4">
          <h3 className="m-0 text-sm font-medium text-ink-2">{t('context.costTitle')}</h3>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 rounded-lg border border-line p-3">
              <dt className="text-xs text-ink-2">{t('context.costTokens')}</dt>
              <dd className="m-0 text-md font-semibold tabular-nums">
                {formatCount(total.tokensIn)} / {formatCount(total.tokensOut)}
              </dd>
            </div>
            <div className="flex flex-col gap-1 rounded-lg border border-line p-3">
              <dt className="text-xs text-ink-2">{t('context.costUsd')}</dt>
              <dd className="m-0 text-md font-semibold tabular-nums">{formatUsd(total.costUsd)}</dd>
            </div>
          </dl>
        </div>
      );
    }
  }
}
