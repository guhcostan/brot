import { useCallback, useEffect, useId, useState, type ReactElement } from 'react';
import { MAX_ROOM_BOTS, MIN_ROOM_BOTS, type Bot, type Task } from '@brot/protocol';
import { Badge, BotAvatar, Button, EmptyState, cx } from '@brot/ui';
import type { CreateMemory, CreateSkill, Memory, Room, Skill, UpdateMemory, UpdateSkill } from '../data/client';
import { avatarOf, formatCount, formatUsd } from '../format';
import { t, type TranslationKey } from '../i18n';
import { botActivity, sumCost, type ThreadState } from '../state/thread';
import { useClient } from './client';
import { ComputerSection } from './ComputerPanel';
import { Close, Plus } from './icons';
import { MemoryTab } from './MemoryTab';
import { SkillsTab } from './SkillsTab';
import { TaskList } from './Tasks';
import { moodOf, useTeam } from './team';

const BOT_TABS = ['memory', 'tasks', 'skills', 'apps', 'routines', 'cost'] as const;
const ROOM_TABS = ['tasks', 'cost'] as const;
export type TabId = (typeof BOT_TABS)[number];

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
  onUpdateMembers: (roomId: string, change: { add?: string[]; remove?: string[] }) => Promise<unknown>;
  onClose: () => void;
  className?: string;
  /** Opens this tab first. Defaults to Memory for a bot and Tasks for a room. */
  initialTab?: TabId;
  /** Memories to render before the client load resolves, e.g. in an SSR render. */
  initialMemories?: Memory[];
  /** Skills to render before the client load resolves, e.g. in an SSR render. */
  initialSkills?: Skill[];
}

/**
 * A bot's computer on top, or a room's members, then text tabs with an underline (DESIGN.md
 * section 7).
 */
export function ContextPanel({
  subject,
  thread,
  tasks,
  onNewTask,
  onUpdateMembers,
  onClose,
  className,
  initialTab,
  initialMemories,
  initialSkills,
}: ContextPanelProps): ReactElement {
  const client = useClient();
  const tabs: readonly TabId[] = subject.kind === 'bot' ? BOT_TABS : ROOM_TABS;
  const [chosen, setTab] = useState<TabId>(initialTab ?? (subject.kind === 'bot' ? 'memory' : 'tasks'));
  const tab = tabs.includes(chosen) ? chosen : tabs[0]!;
  const idBase = useId();
  const botId = subject.kind === 'bot' ? subject.bot.id : null;
  const plainTab: Exclude<TabId, 'tasks' | 'memory' | 'skills'> | null =
    tab === 'apps' || tab === 'routines' || tab === 'cost' ? tab : null;

  const [memories, setMemories] = useState<Memory[] | null>(initialMemories ?? null);
  const [skills, setSkills] = useState<Skill[] | null>(initialSkills ?? null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);

  const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

  const loadMemories = useCallback(async () => {
    if (botId === null) return;
    try {
      setMemories(await client.listMemories(botId));
      setMemoryError(null);
    } catch (cause) {
      setMemoryError(messageOf(cause));
      setMemories((current) => current ?? []);
    }
  }, [botId, client]);

  const loadSkills = useCallback(async () => {
    if (botId === null) return;
    try {
      setSkills(await client.listSkills(botId));
      setSkillError(null);
    } catch (cause) {
      setSkillError(messageOf(cause));
      setSkills((current) => current ?? []);
    }
  }, [botId, client]);

  useEffect(() => {
    if (botId === null) return;
    void loadMemories();
    void loadSkills();
  }, [botId, loadMemories, loadSkills]);

  const createMemory = useCallback(
    async (input: CreateMemory) => {
      if (botId === null) return;
      await client.createMemory(botId, input);
      await loadMemories();
    },
    [botId, client, loadMemories],
  );
  const updateMemory = useCallback(
    async (memoryId: string, patch: UpdateMemory) => {
      await client.updateMemory(memoryId, patch);
      await loadMemories();
    },
    [client, loadMemories],
  );
  const deleteMemory = useCallback(
    async (memoryId: string) => {
      await client.deleteMemory(memoryId);
      await loadMemories();
    },
    [client, loadMemories],
  );
  const createSkill = useCallback(
    async (input: CreateSkill) => {
      await client.createSkill(input);
      await loadSkills();
    },
    [client, loadSkills],
  );
  const updateSkill = useCallback(
    async (skillId: string, patch: UpdateSkill) => {
      await client.updateSkill(skillId, patch);
      await loadSkills();
    },
    [client, loadSkills],
  );
  const deleteSkill = useCallback(
    async (skillId: string) => {
      await client.deleteSkill(skillId);
      await loadSkills();
    },
    [client, loadSkills],
  );
  const exportSkill = useCallback((skillId: string) => client.exportSkill(skillId), [client]);
  const importSkill = useCallback(
    async (input: { content: string; botId?: string }) => {
      const created = await client.importSkill(input);
      await loadSkills();
      return created;
    },
    [client, loadSkills],
  );

  return (
    <aside className={cx('context-panel flex min-h-0 flex-col bg-surface md:border-l md:border-line', className)}>
      <div className="titlebar flex h-14 flex-none items-center justify-between gap-2 border-b border-line px-4 mac-shell:pl-20 md:mac-shell:pl-4">
        <h2 className="m-0 text-base font-semibold tracking-[var(--tracking-heading)]">
          {subject.kind === 'bot' ? t('context.computer') : t('context.members')}
        </h2>
        <Button variant="ghost" size="sm" className="xl:hidden" onClick={onClose}>
          {t('context.close')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {subject.kind === 'bot' ? (
          <ComputerSection bot={subject.bot} thread={thread} />
        ) : (
          <Members room={subject.room} members={subject.members} thread={thread} onUpdate={(change) => onUpdateMembers(subject.room.thread.id, change)} />
        )}

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
          ) : subject.kind === 'bot' && tab === 'memory' ? (
            <MemoryTab
              botName={subject.bot.name}
              memories={memories ?? undefined}
              error={memoryError ?? undefined}
              onCreate={createMemory}
              onUpdate={updateMemory}
              onDelete={deleteMemory}
            />
          ) : subject.kind === 'bot' && tab === 'skills' ? (
            <SkillsTab
              botId={subject.bot.id}
              botName={subject.bot.name}
              skills={skills ?? undefined}
              error={skillError ?? undefined}
              onCreate={createSkill}
              onUpdate={updateSkill}
              onDelete={deleteSkill}
              onExport={exportSkill}
              onImport={importSkill}
            />
          ) : plainTab !== null ? (
            <TabBody tab={plainTab} name={subject.kind === 'bot' ? subject.bot.name : subject.room.thread.title} thread={thread} />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

interface MembersProps {
  room: Room;
  members: Bot[];
  thread: ThreadState;
  onUpdate: (change: { add?: string[]; remove?: string[] }) => Promise<unknown>;
}

/** Room members with their live activity. Members can be added and removed; the lead stays. */
function Members({ room, members, thread, onUpdate }: MembersProps): ReactElement {
  const { bots } = useTeam();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const lead = room.thread.leadBotId ?? room.thread.botId;
  const candidates = Object.values(bots).filter((bot) => !bot.archived && !members.some((member) => member.id === bot.id));
  const canRemove = members.length > MIN_ROOM_BOTS;
  const canAdd = members.length < MAX_ROOM_BOTS && candidates.length > 0;

  const change = async (key: string, input: { add?: string[]; remove?: string[] }) => {
    setBusy(key);
    setError(null);
    try {
      await onUpdate(input);
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-1 border-b border-line p-3">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {members.map((bot) => {
          const avatar = avatarOf(bot);
          const activity = botActivity(thread, bot.id);
          const removable = canRemove && bot.id !== lead;
          return (
            <li key={bot.id} data-avatar-zone className="group flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] items-center gap-3 rounded-md px-1 py-1.5">
              <BotAvatar shape={avatar.shape} color={avatar.color} mood={moodOf(activity)} size="md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{bot.name}</span>
                <span className="truncate text-xs text-ink-2">{activity === 'idle' ? bot.job : t(activity === 'waiting' ? 'status.waiting' : 'status.working')}</span>
              </span>
              {bot.id === lead ? <Badge>{t('room.lead')}</Badge> : null}
              {bot.id === thread.baton && bot.id !== lead ? <Badge>{t('room.next')}</Badge> : null}
              {removable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void change(bot.id, { remove: [bot.id] })}
                  aria-label={t('members.remove', { name: bot.name })}
                  title={t('members.remove', { name: bot.name })}
                  className="!min-h-7 !px-1.5 text-ink-3 opacity-100 group-hover:text-ink md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                >
                  <Close size={14} />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div className="flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] flex-col gap-1.5 px-1 pt-1">
          <label htmlFor={selectId} className="text-xs font-medium text-ink-2">
            {t('members.addLabel')}
          </label>
          <div className="flex gap-2">
            <select
              id={selectId}
              className="brot-input min-w-0 flex-1"
              defaultValue=""
              disabled={busy !== null}
              onChange={(event) => {
                if (event.target.value) void change('add', { add: [event.target.value] });
              }}
            >
              <option value="" disabled>
                {t('members.pick')}
              </option>
              {candidates.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} · {bot.job}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              {t('dialog.cancel')}
            </Button>
          </div>
        </div>
      ) : canAdd ? (
        <Button variant="ghost" size="sm" className="self-start text-ink-2" onClick={() => setAdding(true)}>
          <Plus size={14} />
          {t('members.add')}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 px-1 text-xs text-attention-text">
          {error}
        </p>
      ) : null}
      <p className="m-0 px-1 pt-1 text-xs text-ink-2">
        {room.thread.responder === 'mention'
          ? t('room.ruleMention')
          : room.thread.responder === 'auto'
            ? t('room.ruleAuto')
            : t('room.ruleLeadShort')}
      </p>
    </div>
  );
}

function TabBody({ tab, name, thread }: { tab: Exclude<TabId, 'tasks' | 'memory' | 'skills'>; name: string; thread: ThreadState }): ReactElement {
  switch (tab) {
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
