import { useCallback, useEffect, useReducer } from 'react';
import type { ApprovalDecision, CreateBotInput, UpdateBot } from '@brot/protocol';
import type { BrotClient, NewRoom, NewTask, RoomMessage } from '../data/client';
import { appReducer, initialAppState, type Selection } from './store';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Loads bots, rooms, tasks and history, then folds every live event into thread and task state. */
export function useChat(client: BrotClient) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  useEffect(() => {
    let active = true;
    const stop = client.onEvent(({ botId, roomId, event }) => {
      if (active) dispatch({ type: 'event', botId, roomId, event });
    });

    const loadBots = client.listBots({ includeArchived: true }).then(async (bots) => {
      if (!active) return;
      dispatch({ type: 'bots-loaded', bots });
      await Promise.all(
        bots.map(async (bot) => {
          const events = await client.history(bot.id);
          if (active) dispatch({ type: 'history-loaded', botId: bot.id, events });
        }),
      );
    });

    // Rooms and tasks are team features: a server without them still serves bots and DMs.
    const loadRooms = client.listRooms().then(async (rooms) => {
      if (!active) return;
      dispatch({ type: 'rooms-loaded', rooms });
      await Promise.all(
        rooms.map(async (room) => {
          const events = await client.roomHistory(room.thread.id);
          if (active) dispatch({ type: 'room-history-loaded', roomId: room.thread.id, events });
        }),
      );
    });
    const loadTasks = client.listTasks().then((tasks) => {
      if (active) dispatch({ type: 'tasks-loaded', tasks });
    });

    loadBots.catch((error: unknown) => {
      if (active) dispatch({ type: 'failed', message: messageOf(error) });
    });
    for (const optional of [loadRooms, loadTasks]) {
      optional.catch((error: unknown) => console.warn('Team data did not load', error));
    }

    return () => {
      active = false;
      stop();
    };
  }, [client]);

  const select = useCallback((selection: Selection) => dispatch({ type: 'select', selection }), []);

  const send = useCallback((botId: string, content: string) => client.postMessage(botId, { content }), [client]);

  const sendToRoom = useCallback(
    (roomId: string, input: RoomMessage) => client.postRoomMessage(roomId, input),
    [client],
  );

  const decide = useCallback(
    (approvalId: string, decision: ApprovalDecision, reply?: string) =>
      client.resolveApproval(approvalId, reply ? { decision, reply } : { decision }),
    [client],
  );

  const createRoom = useCallback(
    async (input: NewRoom) => {
      const room = await client.createRoom(input);
      dispatch({ type: 'room-added', room });
      const events = await client.roomHistory(room.thread.id);
      dispatch({ type: 'room-history-loaded', roomId: room.thread.id, events });
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
      dispatch({ type: 'select', selection: { kind: 'bot', id: bot.id } });
      return bot;
    },
    [client],
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
      await client.deleteBot(botId);
      dispatch({ type: 'bot-removed', botId });
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
    send,
    sendToRoom,
    decide,
    createRoom,
    createTask,
    cancelTask,
    createBot,
    updateBot,
    deleteBot,
    updateRoomMembers,
  };
}
