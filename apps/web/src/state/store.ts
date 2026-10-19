import type { Bot, CanonicalEvent, Task } from '@brot/protocol';
import type { Room } from '../data/client';
import {
  applyEvent,
  botActivity,
  botStatus,
  emptyThread,
  foldEvents,
  pendingAsks,
  type BotStatus,
  type ThreadState,
} from './thread';

/** What the main pane shows. */
export type Selection = { kind: 'bot'; id: string } | { kind: 'room'; id: string } | { kind: 'tasks' };

export interface AppState {
  bots: Bot[];
  rooms: Room[];
  selection: Selection | null;
  /** DM threads keyed by bot id. */
  threads: Record<string, ThreadState>;
  /** Room threads keyed by room (thread) id. */
  roomThreads: Record<string, ThreadState>;
  tasks: Record<string, Task>;
  ready: boolean;
  error: string | null;
}

export const initialAppState: AppState = {
  bots: [],
  rooms: [],
  selection: null,
  threads: {},
  roomThreads: {},
  tasks: {},
  ready: false,
  error: null,
};

export type AppAction =
  | { type: 'bots-loaded'; bots: Bot[] }
  | { type: 'rooms-loaded'; rooms: Room[] }
  | { type: 'room-added'; room: Room }
  | { type: 'tasks-loaded'; tasks: Task[] }
  | { type: 'task-saved'; task: Task }
  | { type: 'history-loaded'; botId: string; events: CanonicalEvent[] }
  | { type: 'room-history-loaded'; roomId: string; events: CanonicalEvent[] }
  | { type: 'event'; botId?: string; roomId?: string; event: CanonicalEvent }
  | { type: 'select'; selection: Selection }
  | { type: 'failed'; message: string };

/** Keeps the newer copy of a task, so a late list response never undoes a live update. */
function upsertTask(tasks: Record<string, Task>, task: Task): Record<string, Task> {
  const current = tasks[task.id];
  if (current && Date.parse(current.updatedAt) > Date.parse(task.updatedAt)) return tasks;
  return { ...tasks, [task.id]: task };
}

function withMembers(rooms: Room[], roomId: string, memberIds: string[]): Room[] {
  return rooms.map((room) => (room.thread.id === roomId ? { ...room, memberIds } : room));
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'bots-loaded': {
      const preferred = action.bots.find((bot) => bot.pinned) ?? action.bots[0];
      return {
        ...state,
        bots: action.bots,
        ready: true,
        selection: state.selection ?? (preferred ? { kind: 'bot', id: preferred.id } : null),
      };
    }
    case 'rooms-loaded':
      return { ...state, rooms: action.rooms };
    case 'room-added': {
      const others = state.rooms.filter((room) => room.thread.id !== action.room.thread.id);
      return { ...state, rooms: [action.room, ...others] };
    }
    case 'tasks-loaded':
      return { ...state, tasks: action.tasks.reduce(upsertTask, state.tasks) };
    case 'task-saved':
      return { ...state, tasks: upsertTask(state.tasks, action.task) };
    case 'history-loaded':
      return { ...state, threads: { ...state.threads, [action.botId]: foldEvents(action.events) } };
    case 'room-history-loaded':
      return { ...state, roomThreads: { ...state.roomThreads, [action.roomId]: foldEvents(action.events) } };
    case 'event': {
      const { event } = action;
      let next = state;
      if (event.type === 'task.created' || event.type === 'task.updated') {
        next = { ...next, tasks: upsertTask(next.tasks, event.task) };
      }
      if (event.type === 'room.members' && action.roomId !== undefined) {
        next = { ...next, rooms: withMembers(next.rooms, action.roomId, event.botIds) };
      }
      if (action.roomId !== undefined) {
        const thread = next.roomThreads[action.roomId] ?? emptyThread;
        return { ...next, roomThreads: { ...next.roomThreads, [action.roomId]: applyEvent(thread, event) } };
      }
      if (action.botId !== undefined) {
        const thread = next.threads[action.botId] ?? emptyThread;
        return { ...next, threads: { ...next.threads, [action.botId]: applyEvent(thread, event) } };
      }
      return next;
    }
    case 'select':
      return { ...state, selection: action.selection };
    case 'failed':
      return { ...state, ready: true, error: action.message };
  }
}

/**
 * A bot's status across its DM and every room: waiting for a human anywhere wins, then working
 * anywhere, then the DM's own error.
 */
export function statusOfBot(state: AppState, botId: string): BotStatus {
  const dm = botStatus(state.threads[botId] ?? emptyThread);
  if (dm === 'waiting') return 'waiting';
  const rooms = Object.values(state.roomThreads).map((thread) => botActivity(thread, botId));
  if (rooms.includes('waiting')) return 'waiting';
  if (dm === 'working' || rooms.includes('working')) return 'working';
  return dm;
}

/** A room's status: waiting when any member waits on a human in it, working while any member works in it. */
export function statusOfRoom(state: AppState, roomId: string): BotStatus {
  const thread = state.roomThreads[roomId] ?? emptyThread;
  const status = botStatus(thread);
  if (status === 'waiting' || status === 'error') return status;
  if (Object.keys(thread.activeRuns).length > 0 || pendingAsks(thread).length > 0) return 'working';
  return 'idle';
}

/** The room's members: the latest `room.members` event, else the list the server returned. */
export function membersOf(state: AppState, roomId: string): string[] {
  return state.roomThreads[roomId]?.members ?? state.rooms.find((room) => room.thread.id === roomId)?.memberIds ?? [];
}

export function taskList(state: AppState): Task[] {
  return Object.values(state.tasks).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
