import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { BrandMark, EmptyState, cx } from '@brot/ui';
import { ContextPanel, type ContextSubject } from './components/ContextPanel';
import { NewRoomDialog } from './components/NewRoomDialog';
import { RoomView } from './components/RoomView';
import { Sidebar } from './components/Sidebar';
import { TaskBoard } from './components/TaskBoard';
import { CreateTaskDialog, TaskDetailDialog } from './components/Tasks';
import { TeamProvider, type TeamContextValue } from './components/team';
import { ThreadView } from './components/ThreadView';
import { currentShell } from './components/shell';
import { createClient } from './data';
import { getLocale, setLocale, t, type Locale } from './i18n';
import { membersOf, statusOfBot, statusOfRoom, taskList } from './state/store';
import { tasksForBot, tasksForRoom } from './state/tasks';
import { emptyThread, pendingApprovals } from './state/thread';
import { useChat } from './state/useChat';

type Pane = 'bots' | 'thread' | 'context';

const contextClass = (open: boolean) =>
  open
    ? 'fixed inset-0 z-20 flex md:left-auto md:w-[360px] md:shadow-float xl:static xl:z-auto xl:w-auto xl:shadow-none'
    : 'hidden xl:flex';

/**
 * Three panes like DESIGN.md section 7. Below md the app shows one pane at a time; below xl the
 * context panel is an overlay. The main pane shows a bot's DM, a room, or the task board.
 */
export function App(): ReactElement {
  const client = useMemo(() => createClient(), []);
  const { state, select, send, sendToRoom, decide, createRoom, createTask, cancelTask } = useChat(client);
  const [pane, setPane] = useState<Pane>('thread');
  const [locale, setLocaleState] = useState<Locale>(getLocale);
  const [shell] = useState(currentShell);
  const [newRoomOpen, setNewRoomOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const changeLocale = (next: Locale) => {
    setLocale(next);
    setLocaleState(next);
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

  const goTo = useCallback(
    (selection: Parameters<typeof select>[0]) => {
      select(selection);
      setPane('thread');
    },
    [select],
  );

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

  const subject: ContextSubject | null = bot
    ? { kind: 'bot', bot }
    : room
      ? { kind: 'room', room, members: memberBots(room.thread.id) }
      : null;
  const subjectThread = bot ? (state.threads[bot.id] ?? emptyThread) : room ? (state.roomThreads[room.thread.id] ?? emptyThread) : emptyThread;
  const subjectTasks = bot ? tasksForBot(state.tasks, bot.id) : room ? tasksForRoom(state.tasks, room.thread.id) : [];

  const openBots = () => setPane('bots');
  const openContext = () => setPane('context');

  let main: ReactElement;
  if (selection?.kind === 'tasks') {
    main = <TaskBoard tasks={allTasks} bots={state.bots} onNewTask={() => setNewTaskOpen(true)} onOpenBots={openBots} />;
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
        status={statusOfBot(state, bot.id)}
        onSend={(content) => send(bot.id, content)}
        onDecide={decide}
        onOpenBots={openBots}
        onOpenContext={openContext}
      />
    );
  } else {
    main = (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<BrandMark size="lg" />} title={state.error ?? t('app.tagline')} />
      </div>
    );
  }

  const boardOnly = selection?.kind === 'tasks';
  const taskRoom = room ? { id: room.thread.id, title: room.thread.title, memberIds: membersOf(state, room.thread.id) } : undefined;

  return (
    <TeamProvider value={team}>
      <div
        data-shell={shell}
        className={cx(
          'grid h-dvh grid-cols-1 overflow-hidden bg-bg text-ink md:grid-cols-[264px_minmax(0,1fr)]',
          !boardOnly && 'xl:grid-cols-[264px_minmax(0,1fr)_320px]',
        )}
      >
        <Sidebar
          bots={state.bots}
          rooms={state.rooms}
          statusOf={(botId) => statusOfBot(state, botId)}
          roomStatusOf={(roomId) => statusOfRoom(state, roomId)}
          membersOf={(roomId) => membersOf(state, roomId)}
          activeTasks={activeTasks}
          selection={selection}
          onSelect={goTo}
          onNewRoom={() => setNewRoomOpen(true)}
          locale={locale}
          onLocaleChange={changeLocale}
          className={pane === 'bots' ? 'flex' : 'hidden md:flex'}
        />

        <main className={cx('min-h-0 min-w-0', pane === 'thread' ? 'flex' : 'hidden md:flex')}>{main}</main>

        {subject && !boardOnly ? (
          <ContextPanel
            key={subject.kind === 'bot' ? subject.bot.id : subject.room.thread.id}
            subject={subject}
            thread={subjectThread}
            tasks={subjectTasks}
            onNewTask={() => setNewTaskOpen(true)}
            onClose={() => setPane('thread')}
            className={contextClass(pane === 'context')}
          />
        ) : null}
      </div>

      <NewRoomDialog open={newRoomOpen} bots={state.bots} onClose={() => setNewRoomOpen(false)} onCreate={createRoom} />
      <CreateTaskDialog
        open={newTaskOpen}
        bots={state.bots}
        defaultAssigneeId={bot?.id}
        room={boardOnly ? undefined : taskRoom}
        onClose={() => setNewTaskOpen(false)}
        onCreate={createTask}
      />
      <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} onCancel={cancelTask} />
    </TeamProvider>
  );
}
