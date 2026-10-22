import type { Approval, Bot, CanonicalEvent, Task, Team, Thread } from '@brot/protocol';
import type { Room } from '../data/client';
import {
  applyEvent,
  botActivity,
  botStatus,
  emptyThread,
  foldEvents,
  pendingApprovals,
  pendingAsks,
  type BotStatus,
  type ThreadState,
} from './thread';

/** What the main pane shows. A DM is always one thread of one bot. */
export type Selection =
  | { kind: 'bot'; id: string; threadId: string }
  | { kind: 'room'; id: string }
  | { kind: 'tasks' }
  | { kind: 'approvals' }
  | { kind: 'routines' }
  | { kind: 'settings' };

export interface AppState {
  bots: Bot[];
  rooms: Room[];
  /** Every team, by name. A team groups bots under a shared brief. */
  teams: Team[];
  selection: Selection | null;
  /** Every loaded thread's view, DMs and rooms alike, keyed by thread id. */
  threads: Record<string, ThreadState>;
  /** A bot's DM threads from the last list, most recently active first. */
  threadLists: Record<string, Thread[]>;
  tasks: Record<string, Task>;
  ready: boolean;
  error: string | null;
}

export const initialAppState: AppState = {
  bots: [],
  rooms: [],
  teams: [],
  selection: null,
  threads: {},
  threadLists: {},
  tasks: {},
  ready: false,
  error: null,
};

export type AppAction =
  | { type: 'bots-loaded'; bots: Bot[] }
  | { type: 'rooms-loaded'; rooms: Room[] }
  | { type: 'room-added'; room: Room }
  | { type: 'teams-loaded'; teams: Team[] }
  | { type: 'team-saved'; team: Team }
  | { type: 'team-removed'; teamId: string }
  | { type: 'tasks-loaded'; tasks: Task[] }
  | { type: 'task-saved'; task: Task }
  | { type: 'threads-loaded'; botId: string; threads: Thread[] }
  | { type: 'thread-created'; botId: string; thread: Thread }
  | { type: 'thread-updated'; thread: Thread }
  | { type: 'history-loaded'; threadId: string; events: CanonicalEvent[] }
  | { type: 'event'; threadId: string; botId?: string; roomId?: string; event: CanonicalEvent }
  | { type: 'bot-saved'; bot: Bot }
  | { type: 'bot-removed'; botId: string }
  | { type: 'room-members'; roomId: string; memberIds: string[] }
  | { type: 'select'; selection: Selection }
  | { type: 'failed'; message: string };

const isTaskEvent = (event: CanonicalEvent) => event.type === 'task.created' || event.type === 'task.updated';

/** Keeps the newer copy of a task, so a late list response never undoes a live update. */
function upsertTask(tasks: Record<string, Task>, task: Task): Record<string, Task> {
  const current = tasks[task.id];
  if (current && Date.parse(current.updatedAt) > Date.parse(task.updatedAt)) return tasks;
  return { ...tasks, [task.id]: task };
}

function withMembers(rooms: Room[], roomId: string, memberIds: string[]): Room[] {
  return rooms.map((room) => (room.thread.id === roomId ? { ...room, memberIds } : room));
}

function withThread(list: Thread[], thread: Thread): Thread[] {
  return [thread, ...list.filter((entry) => entry.id !== thread.id)];
}

/** A bot that left its team carries no `teamId` at all, the same shape the server returns. */
function withoutTeam(bot: Bot): Bot {
  const { teamId: _teamId, ...rest } = bot;
  return rest;
}

/** A team whose chief bot is gone has no chief, the same shape the server returns. */
function withoutChief(team: Team): Team {
  const { chiefBotId: _chiefBotId, ...rest } = team;
  return rest;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'bots-loaded':
      return { ...state, bots: action.bots, ready: true };
    case 'rooms-loaded':
      return { ...state, rooms: action.rooms };
    case 'room-added': {
      const others = state.rooms.filter((room) => room.thread.id !== action.room.thread.id);
      return { ...state, rooms: [action.room, ...others] };
    }
    case 'teams-loaded':
      return { ...state, teams: action.teams };
    case 'team-saved': {
      const exists = state.teams.some((team) => team.id === action.team.id);
      return {
        ...state,
        teams: exists ? state.teams.map((team) => (team.id === action.team.id ? action.team : team)) : [...state.teams, action.team],
      };
    }
    case 'team-removed':
      return {
        ...state,
        teams: state.teams.filter((team) => team.id !== action.teamId),
        bots: state.bots.map((bot) => (bot.teamId === action.teamId ? withoutTeam(bot) : bot)),
      };
    case 'tasks-loaded':
      return { ...state, tasks: action.tasks.reduce(upsertTask, state.tasks) };
    case 'task-saved':
      return { ...state, tasks: upsertTask(state.tasks, action.task) };
    case 'threads-loaded':
      return { ...state, threadLists: { ...state.threadLists, [action.botId]: action.threads } };
    case 'thread-created': {
      const list = state.threadLists[action.botId] ?? [];
      return {
        ...state,
        threadLists: { ...state.threadLists, [action.botId]: withThread(list, action.thread) },
        threads: state.threads[action.thread.id] ? state.threads : { ...state.threads, [action.thread.id]: emptyThread },
      };
    }
    case 'thread-updated': {
      const threadLists = Object.fromEntries(
        Object.entries(state.threadLists).map(([botId, list]) => [
          botId,
          list.map((thread) => (thread.id === action.thread.id ? action.thread : thread)),
        ]),
      );
      return { ...state, threadLists };
    }
    case 'history-loaded':
      return { ...state, threads: { ...state.threads, [action.threadId]: foldEvents(action.events) } };
    case 'event': {
      const { event } = action;
      let next = state;
      if (isTaskEvent(event)) next = { ...next, tasks: upsertTask(next.tasks, event.task) };
      if (event.type === 'room.members' && action.roomId !== undefined) {
        next = { ...next, rooms: withMembers(next.rooms, action.roomId, event.botIds) };
      }
      // A task event may arrive before its thread is known; it still reaches the task board.
      if (next.threads[action.threadId] === undefined && isTaskEvent(event)) return next;
      const thread = next.threads[action.threadId] ?? emptyThread;
      return { ...next, threads: { ...next.threads, [action.threadId]: applyEvent(thread, event) } };
    }
    case 'bot-saved': {
      const exists = state.bots.some((bot) => bot.id === action.bot.id);
      return {
        ...state,
        bots: exists ? state.bots.map((bot) => (bot.id === action.bot.id ? action.bot : bot)) : [...state.bots, action.bot],
      };
    }
    case 'bot-removed': {
      const removed = new Set((state.threadLists[action.botId] ?? []).map((thread) => thread.id));
      const threads: Record<string, ThreadState> = {};
      for (const [threadId, thread] of Object.entries(state.threads)) if (!removed.has(threadId)) threads[threadId] = thread;
      const { [action.botId]: _list, ...threadLists } = state.threadLists;
      const bots = state.bots.filter((bot) => bot.id !== action.botId);
      const selected = state.selection?.kind === 'bot' && (state.selection.id === action.botId || removed.has(state.selection.threadId));
      return {
        ...state,
        bots,
        threads,
        threadLists,
        teams: state.teams.map((team) => (team.chiefBotId === action.botId ? withoutChief(team) : team)),
        rooms: state.rooms.map((room) => ({ ...room, memberIds: room.memberIds.filter((id) => id !== action.botId) })),
        selection: selected ? null : state.selection,
      };
    }
    case 'room-members': {
      const thread = state.threads[action.roomId];
      return {
        ...state,
        rooms: withMembers(state.rooms, action.roomId, action.memberIds),
        threads: thread ? { ...state.threads, [action.roomId]: { ...thread, members: action.memberIds } } : state.threads,
      };
    }
    case 'select':
      return { ...state, selection: action.selection };
    case 'failed':
      return { ...state, ready: true, error: action.message };
  }
}

/** A thread's own status, for a thread row in the sidebar. */
export function threadStatusOf(state: AppState, threadId: string): BotStatus {
  return botStatus(state.threads[threadId] ?? emptyThread);
}

/**
 * A bot's status across its loaded DM threads and every room: waiting for a human anywhere wins, then
 * working anywhere, then an error in one of its threads.
 */
export function statusOfBot(state: AppState, botId: string): BotStatus {
  const dms = (state.threadLists[botId] ?? []).map((thread) => botStatus(state.threads[thread.id] ?? emptyThread));
  if (dms.includes('waiting')) return 'waiting';
  const rooms = state.rooms.map((room) => botActivity(state.threads[room.thread.id] ?? emptyThread, botId));
  if (rooms.includes('waiting')) return 'waiting';
  if (dms.includes('working') || rooms.includes('working')) return 'working';
  if (dms.includes('error')) return 'error';
  return 'idle';
}

/** A room's status: waiting when any member waits on a human in it, working while any member works in it. */
export function statusOfRoom(state: AppState, roomId: string): BotStatus {
  const thread = state.threads[roomId] ?? emptyThread;
  const status = botStatus(thread);
  if (status === 'waiting' || status === 'error') return status;
  if (Object.keys(thread.activeRuns).length > 0 || pendingAsks(thread).length > 0) return 'working';
  return 'idle';
}

/** The room's members: the latest `room.members` event, else the list the server returned. */
export function membersOf(state: AppState, roomId: string): string[] {
  return state.threads[roomId]?.members ?? state.rooms.find((room) => room.thread.id === roomId)?.memberIds ?? [];
}

export function taskList(state: AppState): Task[] {
  return Object.values(state.tasks).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export interface InboxEntry {
  approval: Approval;
  /** The room the approval was asked in. Absent for a DM. */
  roomId?: string;
}

/** Every pending approval across the loaded threads, newest first, each listed once. */
export function inbox(state: AppState): InboxEntry[] {
  const roomIds = new Set(state.rooms.map((room) => room.thread.id));
  const seen = new Map<string, InboxEntry>();
  for (const [threadId, thread] of Object.entries(state.threads)) {
    for (const item of pendingApprovals(thread)) {
      if (seen.has(item.approval.id)) continue;
      seen.set(item.approval.id, roomIds.has(threadId) ? { approval: item.approval, roomId: threadId } : { approval: item.approval });
    }
  }
  return [...seen.values()].sort((a, b) => Date.parse(b.approval.createdAt) - Date.parse(a.approval.createdAt));
}
