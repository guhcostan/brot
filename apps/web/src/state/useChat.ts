import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ApprovalDecision, CreateBotInput, CreateTeamInput, Team, Thread, UpdateBot, UpdateTeam, UpdateThread } from '@brot/protocol';
import type { BrotClient, NewRoom, NewTask, RoomMessage } from '../data/client';
import { appReducer, initialAppState, type Selection } from './store';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Loads bots, rooms, tasks and each bot's most recent DM thread, then folds every live event into
 * thread and task state. Other threads of a bot load their history when the person opens them.
 */
export function useChat(client: BrotClient) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadingHistory = useRef(new Set<string>());
  const creatingThread = useRef(new Map<string, Promise<Thread>>());

  const loadHistory = useCallback(
    async (threadId: string, kind: 'dm' | 'room' = 'dm') => {
      if (stateRef.current.threads[threadId] !== undefined || loadingHistory.current.has(threadId)) return;
      loadingHistory.current.add(threadId);
      try {
        const events = kind === 'room' ? await client.roomHistory(threadId) : await client.history(threadId);
        dispatch({ type: 'history-loaded', threadId, events });
      } catch (error) {
        console.warn('Thread history did not load', error);
      } finally {
        loadingHistory.current.delete(threadId);
      }
    },
    [client],
  );

  const loadThreads = useCallback(
    async (botId: string): Promise<Thread[]> => {
      const threads = await client.listThreads(botId);
      dispatch({ type: 'threads-loaded', botId, threads });
      return threads;
    },
    [client],
  );

  const ensureThreads = useCallback(
    async (botId: string): Promise<Thread[]> => {
      const cached = stateRef.current.threadLists[botId];
      return cached ?? loadThreads(botId);
    },
    [loadThreads],
  );

  const ensureThread = useCallback(
    async (botId: string): Promise<Thread> => {
      const threads = await ensureThreads(botId);
      const first = threads[0];
      if (first !== undefined) return first;
      let pending = creatingThread.current.get(botId);
      if (pending === undefined) {
        pending = client
          .createThread(botId)
          .then((thread) => {
            dispatch({ type: 'thread-created', botId, thread });
            return thread;
          })
          .finally(() => creatingThread.current.delete(botId));
        creatingThread.current.set(botId, pending);
      }
      return pending;
    },
    [client, ensureThreads],
  );

  /** Opens a bot's DM: a given thread, else its most recent one, creating the first when it has none. */
  const openBot = useCallback(
    async (botId: string, threadId?: string) => {
      if (threadId !== undefined) {
        dispatch({ type: 'select', selection: { kind: 'bot', id: botId, threadId } });
        void ensureThreads(botId).catch((error: unknown) => console.warn('Thread list did not load', error));
        return;
      }
      const thread = await ensureThread(botId);
      dispatch({ type: 'select', selection: { kind: 'bot', id: botId, threadId: thread.id } });
    },
    [ensureThread, ensureThreads],
  );

  const newThread = useCallback(
    async (botId: string) => {
      const thread = await client.createThread(botId);
      dispatch({ type: 'thread-created', botId, thread });
      dispatch({ type: 'history-loaded', threadId: thread.id, events: [] });
      dispatch({ type: 'select', selection: { kind: 'bot', id: botId, threadId: thread.id } });
      return thread;
    },
    [client],
  );

  useEffect(() => {
    let active = true;
    const stop = client.onEvent(({ threadId, botId, roomId, event }) => {
      if (active) dispatch({ type: 'event', threadId, botId, roomId, event });
    });

    const loadBots = client.listBots({ includeArchived: true }).then(async (bots) => {
      if (!active) return;
      dispatch({ type: 'bots-loaded', bots });
      const preferred = bots.filter((bot) => !bot.archived).find((bot) => bot.pinned) ?? bots.find((bot) => !bot.archived);
      const lists = new Map<string, Thread[]>();
      await Promise.all(
        bots.map(async (bot) => {
          try {
            const threads = await client.listThreads(bot.id);
            lists.set(bot.id, threads);
            if (!active) return;
            dispatch({ type: 'threads-loaded', botId: bot.id, threads });
            const latest = threads[0];
            if (latest !== undefined) await loadHistory(latest.id);
          } catch (error) {
            console.warn('A bot thread list did not load', error);
          }
        }),
      );
      if (!active || preferred === undefined) return;
      const known = lists.get(preferred.id)?.[0];
      if (known !== undefined) {
        dispatch({ type: 'select', selection: { kind: 'bot', id: preferred.id, threadId: known.id } });
        return;
      }
      try {
        const created = await client.createThread(preferred.id);
        if (!active) return;
        dispatch({ type: 'thread-created', botId: preferred.id, thread: created });
        dispatch({ type: 'select', selection: { kind: 'bot', id: preferred.id, threadId: created.id } });
      } catch (error) {
        console.warn('The first thread did not open', error);
      }
    });

    // Rooms and tasks are team features: a server without them still serves bots and DMs.
    const loadRooms = client.listRooms().then(async (rooms) => {
      if (!active) return;
      dispatch({ type: 'rooms-loaded', rooms });
      await Promise.all(
        rooms.map(async (room) => {
          const events = await client.roomHistory(room.thread.id);
          if (active) dispatch({ type: 'history-loaded', threadId: room.thread.id, events });
        }),
      );
    });
    const loadTasks = client.listTasks().then((tasks) => {
      if (active) dispatch({ type: 'tasks-loaded', tasks });
    });
    // A server without teams still serves bots: they all show as ungrouped.
    const loadTeams = client.listTeams().then((teams) => {
      if (active) dispatch({ type: 'teams-loaded', teams });
    });

    loadBots.catch((error: unknown) => {
      if (active) dispatch({ type: 'failed', message: messageOf(error) });
    });
    for (const optional of [loadRooms, loadTasks, loadTeams]) {
      optional.catch((error: unknown) => console.warn('Team data did not load', error));
    }

    return () => {
      active = false;
      stop();
    };
  }, [client, loadHistory]);

  const select = useCallback((selection: Selection | null) => dispatch({ type: 'select', selection }), []);

  /** Posts into a thread, then refreshes that bot's thread list so the server's auto-title shows. */
  const send = useCallback(
    async (threadId: string, botId: string, content: string, attachmentIds: string[] = []) => {
      await client.postMessage(threadId, { content, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) });
      try {
        const threads = await client.listThreads(botId);
        dispatch({ type: 'threads-loaded', botId, threads });
      } catch (error) {
        console.warn('The thread list did not refresh', error);
      }
    },
    [client],
  );

  const sendToRoom = useCallback(
    (roomId: string, input: RoomMessage) => client.postRoomMessage(roomId, input),
    [client],
  );

  const decide = useCallback(
    (approvalId: string, decision: ApprovalDecision, reply?: string) =>
      client.resolveApproval(approvalId, reply ? { decision, reply } : { decision }),
    [client],
  );

  const updateThread = useCallback(
    async (threadId: string, patch: UpdateThread) => {
      const thread = await client.updateThread(threadId, patch);
      dispatch({ type: 'thread-updated', thread });
      return thread;
    },
    [client],
  );

  const deleteRoom = useCallback(
    async (roomId: string) => {
      await client.deleteRoom(roomId);
      dispatch({ type: 'room-removed', roomId });
    },
    [client],
  );

  const createRoom = useCallback(
    async (input: NewRoom) => {
      const room = await client.createRoom(input);
      dispatch({ type: 'room-added', room });
      const events = await client.roomHistory(room.thread.id);
      dispatch({ type: 'history-loaded', threadId: room.thread.id, events });
      dispatch({ type: 'select', selection: { kind: 'room', id: room.thread.id } });
      return room;
    },
    [client],
  );

  const createTask = useCallback(
    async (input: NewTask) => {
      const task = await client.createTask(input);
      dispatch({ type: 'task-saved', task });
      return task;
    },
    [client],
  );

  const cancelTask = useCallback(
    async (taskId: string) => {
      const task = await client.cancelTask(taskId);
      dispatch({ type: 'task-saved', task });
      return task;
    },
    [client],
  );

  const createBot = useCallback(
    async (input: CreateBotInput) => {
      const bot = await client.createBot(input);
      dispatch({ type: 'bot-saved', bot });
      await openBot(bot.id);
      return bot;
    },
    [client, openBot],
  );

  const updateBot = useCallback(
    async (botId: string, patch: UpdateBot) => {
      const bot = await client.updateBot(botId, patch);
      dispatch({ type: 'bot-saved', bot });
      return bot;
    },
    [client],
  );

  const deleteBot = useCallback(
    async (botId: string) => {
      const current = stateRef.current;
      const wasSelected = current.selection?.kind === 'bot' && current.selection.id === botId;
      await client.deleteBot(botId);
      dispatch({ type: 'bot-removed', botId });
      if (!wasSelected) return;
      const remaining = current.bots.filter((bot) => bot.id !== botId && !bot.archived);
      const fallback = remaining.find((bot) => bot.pinned) ?? remaining[0];
      if (fallback) await openBot(fallback.id);
    },
    [client, openBot],
  );

  const createTeam = useCallback(
    async (input: CreateTeamInput): Promise<Team> => {
      const team = await client.createTeam(input);
      dispatch({ type: 'team-saved', team });
      return team;
    },
    [client],
  );

  const updateTeam = useCallback(
    async (teamId: string, patch: UpdateTeam): Promise<Team> => {
      const team = await client.updateTeam(teamId, patch);
      dispatch({ type: 'team-saved', team });
      return team;
    },
    [client],
  );

  const deleteTeam = useCallback(
    async (teamId: string) => {
      await client.deleteTeam(teamId);
      dispatch({ type: 'team-removed', teamId });
    },
    [client],
  );

  const updateRoomMembers = useCallback(
    async (roomId: string, change: { add?: string[]; remove?: string[] }) => {
      const memberIds = await client.updateRoomMembers(roomId, change);
      dispatch({ type: 'room-members', roomId, memberIds });
      return memberIds;
    },
    [client],
  );

  return {
    state,
    select,
    openBot,
    newThread,
    loadThreads,
    loadHistory,
    send,
    sendToRoom,
    updateThread,
    deleteRoom,
    decide,
    createRoom,
    createTask,
    cancelTask,
    createBot,
    updateBot,
    deleteBot,
    createTeam,
    updateTeam,
    deleteTeam,
    updateRoomMembers,
  };
}
