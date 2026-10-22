import { describe, expect, it } from 'vitest';
import type { Approval, Bot, Thread } from '@brot/protocol';
import { appReducer, inbox, initialAppState, statusOfBot, statusOfRoom } from './store';
import { foldEvents } from './thread';

const at = '2026-10-19T09:00:00.000Z';
const later = (seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id,
  name: id,
  job: 'Job',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const thread = (id: string, botId: string, title = id, updatedAt = at): Thread => ({
  id,
  botId,
  title,
  kind: 'dm',
  createdAt: at,
  updatedAt,
});

const approval = (id: string, botId: string, threadId: string, createdAt: string): Approval => ({
  id,
  runId: `run_${id}`,
  threadId,
  botId,
  kind: 'send',
  tool: 'gmail.send',
  summary: 'Send it',
  args: {},
  status: 'pending',
  createdAt,
});

const requested = (item: Approval) => ({
  id: `e_${item.id}`,
  at: item.createdAt,
  threadId: item.threadId,
  type: 'approval.requested' as const,
  approval: item,
});

const running = (threadId: string, botId: string) => ({
  id: `e_run_${threadId}`,
  at,
  threadId,
  runId: `run_${threadId}`,
  type: 'run.started' as const,
  botId,
  engine: 'mock',
});

describe('app store', () => {
  it('marks the app ready when bots load, leaving the thread choice to the chat layer', () => {
    const state = appReducer(initialAppState, { type: 'bots-loaded', bots: [bot('a', { pinned: true }), bot('b')] });
    expect(state.ready).toBe(true);
    expect(state.selection).toBeNull();
  });

  it('stores a thread list per bot, adds a created thread and renames it in place', () => {
    let state = appReducer(initialAppState, { type: 'threads-loaded', botId: 'a', threads: [thread('t2', 'a'), thread('t1', 'a')] });
    expect(state.threadLists.a?.map((entry) => entry.id)).toEqual(['t2', 't1']);

    state = appReducer(state, { type: 'thread-created', botId: 'a', thread: thread('t3', 'a', 'New thread') });
    expect(state.threadLists.a?.map((entry) => entry.id)).toEqual(['t3', 't2', 't1']);
    expect(state.threads.t3).toBeDefined();

    state = appReducer(state, { type: 'thread-updated', thread: thread('t1', 'a', 'Renamed') });
    expect(state.threadLists.a?.find((entry) => entry.id === 't1')?.title).toBe('Renamed');
  });

  it('folds history into the thread it belongs to', () => {
    const state = appReducer(initialAppState, {
      type: 'history-loaded',
      threadId: 't1',
      events: [
        {
          id: 'e1',
          at,
          threadId: 't1',
          type: 'message.completed',
          message: { id: 'm1', threadId: 't1', role: 'user', content: 'Hi', createdAt: at },
        },
      ],
    });
    expect(state.threads.t1?.items).toHaveLength(1);
    expect(state.threads.t2).toBeUndefined();
  });

  it('routes events by thread id, keeping two threads of one bot apart', () => {
    let state = appReducer(initialAppState, {
      type: 'threads-loaded',
      botId: 'a',
      threads: [thread('t1', 'a'), thread('t2', 'a')],
    });
    state = appReducer(state, { type: 'event', threadId: 't1', botId: 'a', event: running('t1', 'a') });
    state = appReducer(state, {
      type: 'event',
      threadId: 't2',
      botId: 'a',
      event: { id: 'e_m', at, threadId: 't2', type: 'message.delta', messageId: 'm', delta: 'Hello' },
    });

    expect(state.threads.t1?.run).toBe('running');
    expect(state.threads.t2?.items).toHaveLength(1);
    expect(state.threads.t1?.items).toHaveLength(0);
  });

  it('routes room events to the room thread and keeps task events live from unknown threads', () => {
    const room = { thread: { ...thread('r1', 'a', 'Acme'), kind: 'room' as const, leadBotId: 'a', responder: 'lead' as const }, memberIds: ['a', 'b'] };
    let state = appReducer(initialAppState, { type: 'rooms-loaded', rooms: [room] });
    state = appReducer(state, {
      type: 'event',
      threadId: 'r1',
      roomId: 'r1',
      event: { id: 'e1', at, threadId: 'r1', type: 'room.members', botIds: ['a', 'b', 'c'] },
    });
    expect(state.threads.r1?.members).toEqual(['a', 'b', 'c']);
    expect(state.rooms[0]?.memberIds).toEqual(['a', 'b', 'c']);

    const task = {
      id: 'task_1',
      title: 'Do it',
      status: 'open' as const,
      assigneeBotId: 'b',
      createdByUser: true,
      threadId: 't_unknown',
      chainId: 'task_1',
      depth: 0,
      createdAt: at,
      updatedAt: at,
    };
    state = appReducer(state, { type: 'event', threadId: 't_unknown', event: { id: 'e2', at, threadId: 't_unknown', type: 'task.created', task } });
    expect(state.tasks.task_1?.status).toBe('open');
    expect(state.threads.t_unknown).toBeUndefined();
  });

  it('removes a bot with every thread it listed and clears the selection', () => {
    let state = appReducer(initialAppState, { type: 'bots-loaded', bots: [bot('a'), bot('b')] });
    state = appReducer(state, { type: 'threads-loaded', botId: 'a', threads: [thread('t1', 'a')] });
    state = appReducer(state, { type: 'threads-loaded', botId: 'b', threads: [thread('t2', 'b')] });
    state = appReducer(state, { type: 'event', threadId: 't2', botId: 'b', event: running('t2', 'b') });
    state = appReducer(state, { type: 'select', selection: { kind: 'bot', id: 'a', threadId: 't1' } });

    state = appReducer(state, { type: 'bot-removed', botId: 'a' });

    expect(state.bots.map((entry) => entry.id)).toEqual(['b']);
    expect(state.threadLists.a).toBeUndefined();
    expect(state.threads.t1).toBeUndefined();
    expect(state.threads.t2).toBeDefined();
    expect(state.selection).toBeNull();
  });

  it('lists every pending approval once, newest first, with its room', () => {
    const older = approval('one', 'a', 't_a', at);
    const newer = approval('two', 'b', 'room_1', later(60));
    const room = { thread: { ...thread('room_1', 'b', 'Acme'), kind: 'room' as const, leadBotId: 'b', responder: 'lead' as const }, memberIds: ['a', 'b'] };
    const state = {
      ...initialAppState,
      rooms: [room],
      threads: {
        t_a: foldEvents([requested(older)]),
        room_1: foldEvents([requested(newer)]),
      },
    };
    expect(inbox(state).map((entry) => entry.approval.id)).toEqual(['two', 'one']);
    expect(inbox(state).find((entry) => entry.approval.id === 'two')?.roomId).toBe('room_1');
  });

  it('derives bot status across its loaded threads and rooms', () => {
    const room = { thread: { ...thread('r1', 'a', 'Acme'), kind: 'room' as const, leadBotId: 'a', responder: 'lead' as const }, memberIds: ['a', 'b'] };
    let state = appReducer(initialAppState, { type: 'rooms-loaded', rooms: [room] });
    state = appReducer(state, { type: 'threads-loaded', botId: 'a', threads: [thread('t1', 'a'), thread('t2', 'a')] });
    state = appReducer(state, { type: 'history-loaded', threadId: 't1', events: [running('t1', 'a')] });
    expect(statusOfBot(state, 'a')).toBe('working');

    state = appReducer(state, {
      type: 'event',
      threadId: 't2',
      botId: 'a',
      event: { ...requested(approval('appr', 'a', 't2', at)), type: 'approval.requested' },
    });
    expect(statusOfBot(state, 'a')).toBe('waiting');

    state = appReducer(state, { type: 'history-loaded', threadId: 't2', events: [] });
    state = appReducer(state, {
      type: 'event',
      threadId: 'r1',
      roomId: 'r1',
      event: { id: 'e_room', at, threadId: 'r1', runId: 'run_room', type: 'run.started', botId: 'a', engine: 'mock' },
    });
    expect(statusOfBot(state, 'a')).toBe('working');
    expect(statusOfRoom(state, 'r1')).toBe('working');
  });

  it('selects a bot thread, a room and the board', () => {
    let state = appReducer(initialAppState, { type: 'select', selection: { kind: 'bot', id: 'a', threadId: 't1' } });
    expect(state.selection).toEqual({ kind: 'bot', id: 'a', threadId: 't1' });
    state = appReducer(state, { type: 'select', selection: { kind: 'room', id: 'r1' } });
    expect(state.selection).toEqual({ kind: 'room', id: 'r1' });
    expect(appReducer(state, { type: 'select', selection: { kind: 'tasks' } }).selection).toEqual({ kind: 'tasks' });
  });
});
