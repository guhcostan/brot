import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Takeover } from '@brot/protocol';
import { BotAvatar, Button, EmptyState, cx } from '@brot/ui';
import { ApprovalsView } from './components/ApprovalsView';
import { BotDialog } from './components/BotDialog';
import { ClientProvider } from './components/client';
import { ContextPanel, type ContextSubject } from './components/ContextPanel';
import { Close, Plus } from './components/icons';
import { NewRoomDialog } from './components/NewRoomDialog';
import { RoomView } from './components/RoomView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TaskBoard } from './components/TaskBoard';
import { CreateTaskDialog, TaskDetailDialog } from './components/Tasks';
import { TeamAvatar, TeamProvider, type TeamContextValue } from './components/team';
import { ThreadView } from './components/ThreadView';
import { currentShell } from './components/shell';
import { createClient } from './data';
import { getLocale, setLocale, t, type Locale } from './i18n';
import { inbox, membersOf, statusOfBot, statusOfRoom, taskList, type Selection } from './state/store';
import { tasksForBot, tasksForRoom } from './state/tasks';
import { emptyThread, pendingApprovals } from './state/thread';
import { useChat } from './state/useChat';
import { getTheme, setTheme as saveTheme, type Theme } from './theme';

type Pane = 'bots' | 'thread' | 'context';

const contextClass = (open: boolean) =>
  open
    ? 'fixed inset-0 z-20 flex md:left-auto md:w-[380px] md:shadow-float xl:static xl:z-auto xl:w-auto xl:shadow-none'
    : 'hidden xl:flex';

const WIDE_QUERY = '(min-width: 1280px)';

/** True at xl and up, where the context panel sits beside the thread instead of over it. */
function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

const selectionKey = (selection: Selection | null) => (selection ? ('id' in selection ? `${selection.kind}:${selection.id}` : selection.kind) : 'none');

/**
 * Three panes like DESIGN.md section 7. Below md the app shows one pane at a time; below xl the
 * context panel is an overlay. The main pane shows a bot's DM, a room, the task board, the approvals
 * inbox, or settings.
 */
export function App(): ReactElement {
  const client = useMemo(() => createClient(), []);
  const chat = useChat(client);
  const { state, select, send, sendToRoom, decide, createRoom, createTask, cancelTask } = chat;
  const [pane, setPane] = useState<Pane>('thread');
  const [locale, setLocaleState] = useState<Locale>(getLocale);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [shell] = useState(currentShell);
  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [botDialog, setBotDialog] = useState<{ botId?: string } | null>(null);
  const [notice, setNotice] = useState<Takeover | null>(null);
  const seenTakeovers = useRef(new Set<string>());
  const wide = useWide();

  const changeLocale = (next: Locale) => {
    setLocale(next);
    setLocaleState(next);
  };

  const changeTheme = (next: Theme) => {
    saveTheme(next);
    setThemeState(next);
  };

  const botsById = useMemo(() => Object.fromEntries(state.bots.map((bot) => [bot.id, bot])), [state.bots]);
  const memberBots = useCallback(
    (roomId: string) => membersOf(state, roomId).flatMap((botId) => (botsById[botId] ? [botsById[botId]] : [])),
    [state, botsById],
  );
  const waitingBots = useMemo(() => {
    const threads = [...Object.values(state.threads), ...Object.values(state.roomThreads)];
    return new Set(threads.flatMap((thread) => pendingApprovals(thread).map((item) => item.approval.botId)));
  }, [state.threads, state.roomThreads]);
  const pending = useMemo(() => inbox(state), [state]);

  const goTo = useCallback(
    (selection: Parameters<typeof select>[0]) => {
      select(selection);
      setPane('thread');
    },
    [select],
  );

  // A bot that asks for the person at its computer opens its panel and says why (docs/COMPUTER-USE.md).
  useEffect(() => {
    const threads = [...Object.values(state.threads), ...Object.values(state.roomThreads)];
    for (const thread of threads) {
      const takeover = thread.takeover;
      if (!takeover) continue;
      const key = `${takeover.botId}:${takeover.at}:${String(takeover.active)}`;
      if (seenTakeovers.current.has(key)) continue;
      seenTakeovers.current.add(key);
      // History replays old takeovers; only a request from the last minute opens the panel.
      const fresh = Date.now() - Date.parse(takeover.at) < 60_000;
      if (takeover.active && takeover.requestedBy === 'bot' && fresh) {
        select({ kind: 'bot', id: takeover.botId });
        setPane('context');
        setNotice(takeover);
      } else if (!takeover.active) {
        setNotice((current) => (current?.botId === takeover.botId ? null : current));
      }
    }
  }, [state.threads, state.roomThreads, select]);

  const team: TeamContextValue = useMemo(
    () => ({
      bots: botsById,
      rooms: state.rooms,
      tasks: state.tasks,
      waitingBots,
      openBot: (id) => goTo({ kind: 'bot', id }),
      openRoom: (id) => goTo({ kind: 'room', id }),
      openTask: setOpenTaskId,
    }),
    [botsById, state.rooms, state.tasks, waitingBots, goTo],
  );

  const { selection } = state;
  const bot = selection?.kind === 'bot' ? (botsById[selection.id] ?? null) : null;
  const room = selection?.kind === 'room' ? (state.rooms.find((entry) => entry.thread.id === selection.id) ?? null) : null;
  const allTasks = taskList(state);
  const activeTasks = allTasks.filter((task) => task.status === 'open' || task.status === 'in_progress' || task.status === 'blocked').length;
  const editing = botDialog?.botId ? botsById[botDialog.botId] : undefined;

  const subject: ContextSubject | null = bot
    ? { kind: 'bot', bot }
    : room
      ? { kind: 'room', room, members: memberBots(room.thread.id) }
      : null;
  const subjectThread = bot ? (state.threads[bot.id] ?? emptyThread) : room ? (state.roomThreads[room.thread.id] ?? emptyThread) : emptyThread;
  const subjectTasks = bot ? tasksForBot(state.tasks, bot.id) : room ? tasksForRoom(state.tasks, room.thread.id) : [];

  const openBots = () => setPane('bots');
  const openContext = () => setPane('context');
  const newBot = () => setBotDialog({});

  let main: ReactElement;
  if (selection?.kind === 'tasks') {
    main = <TaskBoard tasks={allTasks} bots={state.bots} onNewTask={() => setNewTaskOpen(true)} onOpenBots={openBots} />;
  } else if (selection?.kind === 'approvals') {
    main = <ApprovalsView entries={pending} onDecide={decide} onOpenBots={openBots} />;
  } else if (selection?.kind === 'settings') {
    main = <SettingsView locale={locale} onLocaleChange={changeLocale} theme={theme} onThemeChange={changeTheme} onOpenBots={openBots} />;
  } else if (room) {
    main = (
      <RoomView
        key={room.thread.id}
        room={room}
        members={memberBots(room.thread.id)}
        thread={state.roomThreads[room.thread.id] ?? emptyThread}
        status={statusOfRoom(state, room.thread.id)}
        onSend={(input) => sendToRoom(room.thread.id, input)}
        onDecide={decide}
        onOpenBots={openBots}
        onOpenContext={openContext}
      />
    );
  } else if (bot) {
    main = (
      <ThreadView
        key={bot.id}
        bot={bot}
        thread={state.threads[bot.id] ?? emptyThread}
        loaded={state.threads[bot.id] !== undefined}
        status={statusOfBot(state, bot.id)}
        onSend={(content) => send(bot.id, content)}
        onEdit={() => setBotDialog({ botId: bot.id })}
        onDecide={decide}
        onOpenBots={openBots}
        onOpenContext={openContext}
      />
    );
  } else {
    main = (
      <div className="flex flex-1 items-center justify-center" data-avatar-zone>
        <EmptyState
          icon={<BotAvatar species="capivara" color="black" mood={state.error ? 'error' : state.ready ? 'idle' : 'thinking'} size={64} />}
          title={state.error ?? (state.ready ? t('app.noBots') : t('app.tagline'))}
          description={state.ready && !state.error ? t('app.noBotsBody') : undefined}
          actions={
            state.ready && !state.error ? (
              <Button variant="primary" onClick={newBot}>
                <Plus size={16} />
                {t('sidebar.newBot')}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const fullWidth = selection?.kind === 'tasks' || selection?.kind === 'approvals' || selection?.kind === 'settings';
  const taskRoom = room ? { id: room.thread.id, title: room.thread.title, memberIds: membersOf(state, room.thread.id) } : undefined;

  return (
    <ClientProvider value={client}>
      <TeamProvider value={team}>
        <div
          data-shell={shell}
          className={cx(
            'grid h-dvh grid-cols-1 overflow-hidden bg-bg text-ink md:grid-cols-[264px_minmax(0,1fr)]',
            !fullWidth && subject && 'xl:grid-cols-[264px_minmax(0,1fr)_340px]',
          )}
        >
          <Sidebar
            bots={state.bots}
            rooms={state.rooms}
            statusOf={(botId) => statusOfBot(state, botId)}
            roomStatusOf={(roomId) => statusOfRoom(state, roomId)}
            membersOf={(roomId) => membersOf(state, roomId)}
            activeTasks={activeTasks}
            approvals={pending.length}
            ready={state.ready}
            selection={selection}
            onSelect={goTo}
            onNewRoom={() => setNewRoomOpen(true)}
            onNewBot={newBot}
            locale={locale}
            className={pane === 'bots' ? 'flex' : 'hidden md:flex'}
          />

          <main key={selectionKey(selection)} className={cx('pane-enter min-h-0 min-w-0', pane === 'thread' ? 'flex' : 'hidden md:flex')}>
            {main}
          </main>

          {subject && !fullWidth ? (
            <ContextPanel
              key={subject.kind === 'bot' ? subject.bot.id : subject.room.thread.id}
              subject={subject}
              thread={subjectThread}
              tasks={subjectTasks}
              onNewTask={() => setNewTaskOpen(true)}
              onUpdateMembers={chat.updateRoomMembers}
              onClose={() => setPane('thread')}
              className={contextClass(pane === 'context')}
            />
          ) : null}
        </div>

        {notice && !(bot?.id === notice.botId && (wide || pane === 'context')) ? (
          <TakeoverNotice
            takeover={notice}
            name={botsById[notice.botId]?.name ?? t('team.unknownBot')}
            onOpen={() => {
              select({ kind: 'bot', id: notice.botId });
              setPane('context');
            }}
            onDismiss={() => setNotice(null)}
          />
        ) : null}

        <NewRoomDialog open={newRoomOpen} bots={state.bots.filter((entry) => !entry.archived)} onClose={() => setNewRoomOpen(false)} onCreate={createRoom} />
        <BotDialog
          open={botDialog !== null}
          bot={editing}
          loadProviders={client.listProviders}
          onCreate={chat.createBot}
          onUpdate={chat.updateBot}
          onDelete={async (botId) => {
            await chat.deleteBot(botId);
            setBotDialog(null);
          }}
          onOpenSettings={() => goTo({ kind: 'settings' })}
          onClose={() => setBotDialog(null)}
        />
        <CreateTaskDialog
          open={newTaskOpen}
          bots={state.bots.filter((entry) => !entry.archived)}
          defaultAssigneeId={bot?.id}
          room={fullWidth ? undefined : taskRoom}
          onClose={() => setNewTaskOpen(false)}
          onCreate={createTask}
        />
        <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} onCancel={cancelTask} />
      </TeamProvider>
    </ClientProvider>
  );
}

interface TakeoverNoticeProps {
  takeover: Takeover;
  name: string;
  onOpen: () => void;
  onDismiss: () => void;
}

/** A bot asked for the person at its computer. Stays until control goes back or it is dismissed. */
function TakeoverNotice({ takeover, name, onOpen, onDismiss }: TakeoverNoticeProps): ReactElement {
  return (
    <div
      role="alert"
      data-avatar-zone
      className="fixed right-4 bottom-4 left-4 z-30 flex animate-[brot-rise_220ms_var(--ease)_both] items-start gap-3 rounded-lg border border-attention bg-surface p-3 shadow-float sm:left-auto sm:w-[380px]"
    >
      <TeamAvatar botId={takeover.botId} size={32} mood="approval" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-sm font-semibold">{t('computer.botAsks', { name })}</p>
        {takeover.reason ? <p className="m-0 text-sm text-ink-2">{takeover.reason}</p> : null}
        <div className="mt-1 flex gap-2">
          <Button variant="primary" size="sm" onClick={onOpen}>
            {t('computer.openScreen')}
          </Button>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss} aria-label={t('dialog.close')} className="-mt-1 -mr-1">
        <Close size={14} />
      </Button>
    </div>
  );
}
