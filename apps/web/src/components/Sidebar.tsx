import { useMemo, useState, type ReactElement } from 'react';
import type { Bot, Team, Thread } from '@brot/protocol';
import { AvatarStack, BotAvatar, BrandMark, Button, Input, STATUS_MOOD, Skeleton, StatusDot, cx, type BotStatus } from '@brot/ui';
import type { Room } from '../data/client';
import { avatarOf } from '../format';
import { t, type Locale } from '../i18n';
import type { Selection } from '../state/store';
import { Board, ChevronRight, Gear, Inbox, Pencil, Plus } from './icons';
import { useLiveMood } from './mood';
import { memberSummary } from './RoomView';
import { botStatusLabel } from './taskLabels';

export interface SidebarProps {
  bots: Bot[];
  rooms: Room[];
  teams: Team[];
  /** Each bot's DM threads, most recently active first. Missing until the list has loaded. */
  threadLists: Record<string, Thread[]>;
  statusOf: (botId: string) => BotStatus;
  /** A single thread's status, for its row. */
  threadStatusOf: (threadId: string) => BotStatus;
  roomStatusOf: (roomId: string) => BotStatus;
  membersOf: (roomId: string) => string[];
  activeTasks: number;
  /** Pending approvals across every loaded thread. */
  approvals: number;
  ready: boolean;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  /** Opens a bot's most recent thread. */
  onOpenBot: (botId: string) => void;
  onOpenThread: (botId: string, threadId: string) => void;
  onLoadThreads: (botId: string) => Promise<Thread[]>;
  onNewThread: (botId: string) => void;
  onNewRoom: () => void;
  onNewBot: () => void;
  onNewTeam: () => void;
  /** Opens the team dialog for an existing team. */
  onEditTeam: (teamId: string) => void;
  /** Re-renders the sidebar's copy when the language changes. */
  locale: Locale;
  /** Bots whose thread rows start expanded. */
  defaultExpanded?: readonly string[];
  className?: string;
}

const rowClass =
  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 aria-[current=true]:bg-surface-2';

const toggleIn = (set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

/** Collapse key for the bots that belong to no team. */
const UNGROUPED_GROUP = 'ungrouped';

export function Sidebar({
  bots,
  rooms,
  teams,
  threadLists,
  statusOf,
  threadStatusOf,
  roomStatusOf,
  membersOf,
  activeTasks,
  approvals,
  ready,
  selection,
  onSelect,
  onOpenBot,
  onOpenThread,
  onLoadThreads,
  onNewThread,
  onNewRoom,
  onNewBot,
  onNewTeam,
  onEditTeam,
  defaultExpanded,
  className,
}: SidebarProps): ReactElement {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(defaultExpanded ?? []));
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!needle) return bots;
    return bots.filter((bot) => bot.name.toLowerCase().includes(needle) || bot.job.toLowerCase().includes(needle));
  }, [bots, needle]);

  const visibleRooms = useMemo(() => {
    if (!needle) return rooms;
    const named = (botId: string) => bots.find((bot) => bot.id === botId)?.name.toLowerCase() ?? '';
    return rooms.filter(
      (room) => room.thread.title.toLowerCase().includes(needle) || membersOf(room.thread.id).some((id) => named(id).includes(needle)),
    );
  }, [rooms, bots, needle, membersOf]);

  /** Active bots under their team headings, plus the ones with no team. Pinned bots sort first in a group. */
  const { teamGroups, ungrouped } = useMemo(() => {
    const teamById = new Map(teams.map((team) => [team.id, team]));
    const pinnedFirst = (list: Bot[]) => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    const members = new Map<string, Bot[]>();
    const loose: Bot[] = [];
    for (const bot of visible) {
      if (bot.archived) continue;
      // A bot whose team has not loaded yet stays visible as ungrouped rather than disappearing.
      const team = bot.teamId === undefined ? undefined : teamById.get(bot.teamId);
      if (team === undefined) loose.push(bot);
      else members.set(team.id, [...(members.get(team.id) ?? []), bot]);
    }
    const groups = [...members].flatMap(([teamId, list]) => {
      const team = teamById.get(teamId);
      return team === undefined ? [] : [{ team, bots: pinnedFirst(list) }];
    });
    groups.sort((a, b) => a.team.name.localeCompare(b.team.name) || a.team.id.localeCompare(b.team.id));
    return { teamGroups: groups, ungrouped: pinnedFirst(loose) };
  }, [visible, teams]);

  const expand = (botId: string) => {
    setExpanded((current) => toggleIn(current, botId, true));
    if (threadLists[botId] !== undefined || loading.has(botId)) return;
    setLoading((current) => new Set(current).add(botId));
    void onLoadThreads(botId)
      .catch((error: unknown) => console.warn('A bot thread list did not load', error))
      .finally(() => setLoading((current) => toggleIn(current, botId, false)));
  };

  const toggle = (botId: string) => {
    if (expanded.has(botId)) setExpanded((current) => toggleIn(current, botId, false));
    else expand(botId);
  };

  const toggleGroup = (groupId: string) => setCollapsedGroups((current) => toggleIn(current, groupId, !current.has(groupId)));

  const createThread = (botId: string) => {
    setExpanded((current) => toggleIn(current, botId, true));
    onNewThread(botId);
  };

  const archived = visible.filter((bot) => bot.archived);
  const selectedBot = selection?.kind === 'bot' ? selection.id : null;
  const selectedThread = selection?.kind === 'bot' ? selection.threadId : null;
  const selectedRoom = selection?.kind === 'room' ? selection.id : null;
  const threadRows = {
    threadLists,
    threadStatusOf,
    selectedThreadId: selectedThread,
    expanded,
    loading,
    onOpenThread,
    onToggle: toggle,
    onNewThread: createThread,
  };
  const rowProps = { statusOf, selectedId: selectedBot, onOpenBot, ...threadRows };
  const nothing = ready && needle !== '' && visible.length === 0 && visibleRooms.length === 0;

  return (
    <nav
      aria-label={t('sidebar.label')}
      className={cx('flex min-h-0 flex-col gap-4 bg-surface px-3 pt-4 pb-3 mac-shell:pt-0 md:border-r md:border-line', className)}
    >
      <div className="titlebar flex h-8 items-center gap-2 px-2 mac-shell:-mx-3 mac-shell:h-11 mac-shell:pr-5 mac-shell:pl-20">
        <BrandMark size={22} />
        <span className="flex-1 text-lg leading-none font-semibold tracking-[var(--tracking-tight)]">{t('app.name')}</span>
        <Button variant="secondary" size="sm" onClick={onNewBot} className="!min-h-7 !gap-1 !px-2 text-xs">
          <Plus size={14} />
          {t('sidebar.newBot')}
        </Button>
      </div>

      <Input
        type="search"
        label={t('sidebar.search')}
        hideLabel
        placeholder={t('sidebar.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        <div className="-mb-2 flex flex-col gap-0.5">
        <button
          type="button"
          aria-current={selection?.kind === 'approvals' ? 'true' : undefined}
          onClick={() => onSelect({ kind: 'approvals' })}
          className={cx(rowClass, 'py-1.5')}
        >
          <span className={cx('flex size-8 flex-none items-center justify-center', approvals > 0 ? 'text-attention-text' : 'text-ink')}>
            <Inbox />
          </span>
          <span className="flex-1 text-base font-medium text-ink">{t('approvals.title')}</span>
          {approvals > 0 ? (
            <span
              key={approvals}
              className="inline-flex min-w-5 animate-[brot-pop_260ms_var(--ease)_both] items-center justify-center rounded-full bg-attention px-1.5 text-xs leading-5 font-semibold text-[var(--primary-ink)] tabular-nums"
              aria-label={t('sidebar.pendingApprovals', { count: String(approvals) })}
            >
              {approvals}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          aria-current={selection?.kind === 'tasks' ? 'true' : undefined}
          onClick={() => onSelect({ kind: 'tasks' })}
          className={cx(rowClass, 'py-1.5')}
        >
          <span className="flex size-8 flex-none items-center justify-center text-ink">
            <Board />
          </span>
          <span className="flex-1 text-base font-medium text-ink">{t('board.title')}</span>
          {activeTasks > 0 ? (
            <span className="text-xs text-ink-2 tabular-nums" aria-label={t('sidebar.activeTasks', { count: String(activeTasks) })}>
              {activeTasks}
            </span>
          ) : null}
        </button>
        </div>

        {nothing ? <p className="px-2 text-sm text-ink-2">{t('sidebar.empty', { query })}</p> : null}

        <section className="flex flex-col gap-1" aria-labelledby="sidebar-rooms">
          <div className="flex items-center justify-between pr-1 pl-2">
            <h2 id="sidebar-rooms" className="m-0 pb-1 text-xs font-medium text-ink-3">
              {t('sidebar.rooms')}
            </h2>
            <Button variant="ghost" size="sm" onClick={onNewRoom} aria-label={t('sidebar.newRoom')} title={t('sidebar.newRoom')} className="!min-h-6 !px-1.5 text-ink-2">
              <Plus size={14} />
            </Button>
          </div>
          {visibleRooms.length === 0 && !needle ? (
            <button type="button" onClick={onNewRoom} className="rounded-md px-2 py-2 text-left text-sm text-ink-2 hover:bg-surface-2">
              {t('sidebar.noRooms')}
            </button>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {visibleRooms.map((room) => {
              const id = room.thread.id;
              const selected = id === selectedRoom;
              const status = roomStatusOf(id);
              const members = membersOf(id)
                .map((botId) => bots.find((bot) => bot.id === botId))
                .filter((bot): bot is Bot => bot !== undefined);
              const names = memberSummary(members.map((bot) => bot.name));
              return (
                <li key={id}>
                  <button
                    type="button"
                    data-avatar-zone
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect({ kind: 'room', id })}
                    className={cx(rowClass, 'group')}
                  >
                    <span className="flex w-8 flex-none justify-start">
                      <AvatarStack
                        members={members.map((bot) => ({ id: bot.id, ...avatarOf(bot), mood: STATUS_MOOD[statusOf(bot.id) === 'working' ? 'working' : 'idle'] }))}
                        max={2}
                        size={21}
                        showCount={false}
                        className="[--stack-cutout:var(--surface)] group-hover:[--stack-cutout:var(--surface-2)] group-aria-[current=true]:[--stack-cutout:var(--surface-2)]"
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base font-medium text-ink">{room.thread.title}</span>
                      {status === 'idle' ? (
                        <span className="truncate text-sm text-ink-2">{names}</span>
                      ) : (
                        <StatusDot status={status} label={botStatusLabel(status)} className="text-sm" />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {!ready ? <SidebarSkeleton /> : null}
        {teamGroups.map((group) => (
          <BotGroup
            key={group.team.id}
            title={group.team.name}
            titleId={`sidebar-team-${group.team.id}`}
            bots={group.bots}
            collapsed={collapsedGroups.has(group.team.id)}
            onToggleCollapsed={() => toggleGroup(group.team.id)}
            editLabel={t('sidebar.editTeam', { name: group.team.name })}
            onEdit={() => onEditTeam(group.team.id)}
            {...rowProps}
          />
        ))}
        {ungrouped.length > 0 ? (
          <BotGroup
            title={t('sidebar.ungrouped')}
            titleId="sidebar-ungrouped"
            bots={ungrouped}
            collapsed={collapsedGroups.has(UNGROUPED_GROUP)}
            onToggleCollapsed={() => toggleGroup(UNGROUPED_GROUP)}
            {...rowProps}
          />
        ) : null}
        {ready && teamGroups.length === 0 && ungrouped.length === 0 && !needle && archived.length === 0 ? (
          <button type="button" onClick={onNewBot} data-avatar-zone className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-3 py-5 text-center text-sm text-ink-2 hover:bg-surface-2">
            <BotAvatar species="capivara" color="black" size={36} />
            {t('sidebar.noBots')}
          </button>
        ) : null}
        {ready ? (
          <button
            type="button"
            onClick={onNewTeam}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-ink-3 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink-2"
          >
            <Plus size={14} />
            {t('sidebar.newTeam')}
          </button>
        ) : null}
        {archived.length > 0 ? (
          <section className="flex flex-col gap-1">
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((open) => !open)}
              className="flex items-center gap-1.5 rounded-md px-2 pb-1 text-left text-xs font-medium text-ink-3 hover:text-ink-2"
            >
              {t('sidebar.archived', { count: String(archived.length) })}
              <span aria-hidden="true" className={cx('inline-block transition-transform duration-[var(--dur-fast)]', showArchived && 'rotate-90')}>
                ›
              </span>
            </button>
            {showArchived ? <BotList bots={archived} {...rowProps} /> : null}
          </section>
        ) : null}
      </div>

      <footer className="-mx-3 flex flex-none border-t border-line px-3 pt-3">
        <button
          type="button"
          aria-current={selection?.kind === 'settings' ? 'true' : undefined}
          onClick={() => onSelect({ kind: 'settings' })}
          className={cx(rowClass, 'py-1.5 text-sm text-ink-2 hover:text-ink aria-[current=true]:text-ink')}
        >
          <span className="flex size-8 flex-none items-center justify-center">
            <Gear />
          </span>
          <span className="flex-1 font-medium">{t('settings.title')}</span>
        </button>
      </footer>
    </nav>
  );
}

interface ThreadRowsProps {
  threadLists: Record<string, Thread[]>;
  threadStatusOf: (threadId: string) => BotStatus;
  selectedThreadId: string | null;
  expanded: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  onOpenThread: (botId: string, threadId: string) => void;
  onToggle: (botId: string) => void;
  onNewThread: (botId: string) => void;
}

interface BotListProps extends ThreadRowsProps {
  bots: Bot[];
  statusOf: (botId: string) => BotStatus;
  selectedId: string | null;
  onOpenBot: (botId: string) => void;
  /** Ties the list to the collapsible heading above it. */
  listId?: string;
}

interface BotGroupProps extends BotListProps {
  title: string;
  titleId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The pencil that opens the team dialog. Absent for the ungrouped group, which has no team. */
  editLabel?: string;
  onEdit?: () => void;
}

/** A collapsible heading over its bots: a team, or the bots that belong to no team. */
function BotGroup({ title, titleId, collapsed, onToggleCollapsed, editLabel, onEdit, ...list }: BotGroupProps): ReactElement {
  const listId = `${titleId}-bots`;
  const countLabel = t(list.bots.length === 1 ? 'sidebar.teamBotCountOne' : 'sidebar.teamBotCountMany', { count: String(list.bots.length) });
  return (
    <section className="flex flex-col gap-1" aria-labelledby={titleId}>
      <div className="flex items-center justify-between pr-1 pl-2">
        <h2 id={titleId} className="m-0 min-w-0">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={onToggleCollapsed}
            className="flex min-w-0 items-center gap-1.5 rounded-md py-1 text-left text-xs font-medium text-ink-3 transition-colors duration-[var(--dur-fast)] hover:text-ink-2"
          >
            <ChevronRight size={12} className={cx('flex-none transition-transform duration-[var(--dur-fast)]', !collapsed && 'rotate-90')} />
            <span className="truncate">{title}</span>
            <span className="flex-none tabular-nums" aria-label={countLabel}>
              {list.bots.length}
            </span>
          </button>
        </h2>
        {editLabel && onEdit ? (
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={editLabel} title={editLabel} className="!min-h-6 !px-1.5 text-ink-2">
            <Pencil size={13} />
          </Button>
        ) : null}
      </div>
      {collapsed ? null : <BotList {...list} listId={listId} />}
    </section>
  );
}

function BotList({ bots, statusOf, selectedId, onOpenBot, listId, ...threadRows }: BotListProps): ReactElement {
  return (
    <ul id={listId} className="m-0 flex list-none flex-col gap-0.5 p-0">
      {bots.map((bot) => (
        <li key={bot.id} className="animate-[brot-enter_var(--dur-base)_var(--ease)_both]">
          <BotRow bot={bot} status={statusOf(bot.id)} selected={bot.id === selectedId} onOpenBot={onOpenBot} {...threadRows} />
        </li>
      ))}
    </ul>
  );
}

interface BotRowProps extends ThreadRowsProps {
  bot: Bot;
  status: BotStatus;
  selected: boolean;
  onOpenBot: (botId: string) => void;
}

function BotRow({ bot, status, selected, onOpenBot, threadLists, threadStatusOf, selectedThreadId, expanded, loading, onOpenThread, onToggle, onNewThread }: BotRowProps): ReactElement {
  const avatar = avatarOf(bot);
  const mood = useLiveMood(status);
  const open = expanded.has(bot.id);
  const threads = threadLists[bot.id];
  const busy = loading.has(bot.id);
  return (
    <div className="flex flex-col">
      <div className={cx('group flex items-center rounded-md pr-1 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2', selected && 'bg-surface-2')}>
        <button
          type="button"
          data-avatar-zone
          aria-current={selected ? 'true' : undefined}
          onClick={() => onOpenBot(bot.id)}
          className={cx('flex min-w-0 flex-1 items-center gap-3 py-2 pl-2 text-left', bot.archived && 'opacity-60')}
        >
          <BotAvatar shape={avatar.shape} color={avatar.color} mood={bot.archived ? 'sleeping' : mood} size="md" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-base font-medium text-ink">{bot.name}</span>
            {status === 'idle' ? (
              <span className="truncate text-sm text-ink-2">{bot.job}</span>
            ) : (
              <StatusDot status={status} label={botStatusLabel(status)} className="text-sm" />
            )}
          </span>
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(open ? 'sidebar.collapseThreads' : 'sidebar.expandThreads', { name: bot.name })}
          title={t(open ? 'sidebar.collapseThreads' : 'sidebar.expandThreads', { name: bot.name })}
          onClick={() => onToggle(bot.id)}
          className="flex size-7 flex-none items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <ChevronRight size={14} className={cx('transition-transform duration-[var(--dur-fast)]', open && 'rotate-90')} />
        </button>
      </div>
      {open ? (
        <div role="group" aria-label={t('sidebar.threads', { name: bot.name })} className="flex animate-[brot-enter_var(--dur-base)_var(--ease)_both] flex-col gap-0.5 pt-0.5 pb-1 pl-11">
          {busy && threads === undefined ? <span className="px-2 py-1 text-xs text-ink-3">{t('app.loading')}</span> : null}
          {(threads ?? []).map((thread) => {
            const threadStatus = threadStatusOf(thread.id);
            return (
              <button
                key={thread.id}
                type="button"
                aria-current={thread.id === selectedThreadId ? 'true' : undefined}
                onClick={() => onOpenThread(bot.id, thread.id)}
                className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 aria-[current=true]:bg-surface-2"
              >
                <span className={cx('min-w-0 flex-1 truncate text-sm', thread.id === selectedThreadId ? 'text-ink' : 'text-ink-2')}>{thread.title}</span>
                {threadStatus !== 'idle' ? <StatusDot status={threadStatus} label={botStatusLabel(threadStatus)} className="flex-none text-xs" /> : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onNewThread(bot.id)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-ink-3 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink-2"
          >
            <Plus size={14} />
            {t('sidebar.newThread')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SidebarSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-3 px-2" aria-busy="true" aria-label={t('app.loading')}>
      {[72, 56, 64, 48, 60].map((width, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton shape="circle" width={32} height={32} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton width={`${width}%`} height={11} />
            <Skeleton width={`${width - 20}%`} height={9} />
          </div>
        </div>
      ))}
    </div>
  );
}
