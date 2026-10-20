import { useMemo, useState, type ReactElement } from 'react';
import type { Bot } from '@brot/protocol';
import { AvatarStack, BotAvatar, BrandMark, Button, Input, STATUS_MOOD, Skeleton, StatusDot, cx, type BotStatus } from '@brot/ui';
import type { Room } from '../data/client';
import { avatarOf } from '../format';
import { t, type Locale } from '../i18n';
import type { Selection } from '../state/store';
import { Board, Gear, Inbox, Plus } from './icons';
import { useLiveMood } from './mood';
import { memberSummary } from './RoomView';
import { botStatusLabel } from './taskLabels';

export interface SidebarProps {
  bots: Bot[];
  rooms: Room[];
  statusOf: (botId: string) => BotStatus;
  roomStatusOf: (roomId: string) => BotStatus;
  membersOf: (roomId: string) => string[];
  activeTasks: number;
  /** Pending approvals across every bot and room. */
  approvals: number;
  ready: boolean;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onNewRoom: () => void;
  onNewBot: () => void;
  /** Re-renders the sidebar's copy when the language changes. */
  locale: Locale;
  className?: string;
}

const rowClass =
  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 aria-[current=true]:bg-surface-2';

export function Sidebar({
  bots,
  rooms,
  statusOf,
  roomStatusOf,
  membersOf,
  activeTasks,
  approvals,
  ready,
  selection,
  onSelect,
  onNewRoom,
  onNewBot,
  className,
}: SidebarProps): ReactElement {
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
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

  const pinned = visible.filter((bot) => bot.pinned && !bot.archived);
  const others = visible.filter((bot) => !bot.pinned && !bot.archived);
  const archived = visible.filter((bot) => bot.archived);
  const selectedBot = selection?.kind === 'bot' ? selection.id : null;
  const selectedRoom = selection?.kind === 'room' ? selection.id : null;
  const rowProps = { statusOf, selectedId: selectedBot, onSelect: (id: string) => onSelect({ kind: 'bot', id }) };
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
        {pinned.length > 0 ? <BotSection title={t('sidebar.pinned')} bots={pinned} {...rowProps} /> : null}
        {others.length > 0 ? <BotSection title={t('sidebar.all')} bots={others} {...rowProps} /> : null}
        {ready && pinned.length === 0 && others.length === 0 && !needle ? (
          <button type="button" onClick={onNewBot} data-avatar-zone className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-3 py-5 text-center text-sm text-ink-2 hover:bg-surface-2">
            <BotAvatar species="capivara" color="black" size={36} />
            {t('sidebar.noBots')}
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

interface BotSectionProps {
  title: string;
  bots: Bot[];
  statusOf: (botId: string) => BotStatus;
  selectedId: string | null;
  onSelect: (botId: string) => void;
}

function BotSection({ title, ...rest }: BotSectionProps): ReactElement {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="m-0 px-2 pb-1 text-xs font-medium text-ink-3">{title}</h2>
      <BotList {...rest} />
    </section>
  );
}

function BotList({ bots, statusOf, selectedId, onSelect }: Omit<BotSectionProps, 'title'>): ReactElement {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {bots.map((bot) => (
        <li key={bot.id} className="animate-[brot-enter_var(--dur-base)_var(--ease)_both]">
          <BotRow bot={bot} status={statusOf(bot.id)} selected={bot.id === selectedId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

function BotRow({ bot, status, selected, onSelect }: { bot: Bot; status: BotStatus; selected: boolean; onSelect: (botId: string) => void }): ReactElement {
  const avatar = avatarOf(bot);
  const mood = useLiveMood(status);
  return (
    <button
      type="button"
      data-avatar-zone
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(bot.id)}
      className={cx(rowClass, bot.archived && 'opacity-60')}
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
