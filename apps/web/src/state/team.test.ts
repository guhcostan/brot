import { describe, expect, it } from 'vitest';
import type { CanonicalEvent, Task } from '@brot/protocol';
import { appReducer, initialAppState, membersOf, statusOfBot, statusOfRoom, type AppState } from './store';
import { ancestorsOf, childrenOf, groupByStatus, tasksForBot, tasksForRoom } from './tasks';
import {
  botActivity,
  foldEvents,
  gazeTargets,
  pendingAsks,
  type ExchangeItem,
  type HandoffItem,
  type MessageItem,
} from './thread';

const at = '2026-10-19T12:00:00.000Z';
const later = (s: number) => new Date(Date.parse(at) + s * 1000).toISOString();
const base = { at, threadId: 'room_1' };

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    status: 'open',
    assigneeBotId: 'bot_onca',
    createdByUser: false,
    createdByBotId: 'bot_capy',
    threadId: 'room_1',
    chainId: 'root',
    depth: 1,
    createdAt: at,
    updatedAt: at,
    ...patch,
  };
}

const root = task('root', { createdByUser: true, createdByBotId: undefined, depth: 0, assigneeBotId: 'bot_capy' });

describe('team events in the thread fold', () => {
  it('attributes streamed text to the bot whose run produced it', () => {
    const state = foldEvents([
      { ...base, id: 'e1', runId: 'r1', type: 'run.started', botId: 'bot_capy', engine: 'mock' },
      { ...base, id: 'e2', runId: 'r2', type: 'run.started', botId: 'bot_onca', engine: 'mock' },
      { ...base, id: 'e3', runId: 'r2', type: 'message.delta', messageId: 'm2', delta: 'On it' },
      { ...base, id: 'e4', runId: 'r1', type: 'message.delta', messageId: 'm1', delta: 'Sure' },
    ]);
    expect(state.items).toEqual([
      expect.objectContaining({ id: 'm2', authorBotId: 'bot_onca', streaming: true }),
      expect.objectContaining({ id: 'm1', authorBotId: 'bot_capy', streaming: true }),
    ]);
  });

  it('keeps author, mentions and recipient from a completed message', () => {
    const state = foldEvents([
      {
        ...base,
        id: 'e1',
        type: 'message.completed',
        message: { id: 'm1', threadId: 'room_1', role: 'user', content: 'brief', createdAt: at, authorBotId: 'bot_capy', viaBotId: 'bot_onca', mentions: ['bot_onca'] },
      },
    ]);
    expect(state.items[0] as MessageItem).toMatchObject({ authorBotId: 'bot_capy', viaBotId: 'bot_onca', mentions: ['bot_onca'] });
  });

  it('settles only the finished bot\'s stream when two bots run at once', () => {
    const state = foldEvents([
      { ...base, id: 'e1', runId: 'r1', type: 'run.started', botId: 'bot_capy', engine: 'mock' },
      { ...base, id: 'e2', runId: 'r2', type: 'run.started', botId: 'bot_onca', engine: 'mock' },
      { ...base, id: 'e3', runId: 'r1', type: 'message.delta', messageId: 'm1', delta: 'a' },
      { ...base, id: 'e4', runId: 'r2', type: 'message.delta', messageId: 'm2', delta: 'b' },
      { ...base, id: 'e5', runId: 'r1', type: 'run.completed' },
    ]);
    expect(state.run).toBe('running');
    expect(Object.keys(state.activeRuns)).toEqual(['r2']);
    expect((state.items as MessageItem[]).map((item) => item.streaming)).toEqual([false, true]);
    expect(botActivity(state, 'bot_onca')).toBe('working');
    expect(botActivity(state, 'bot_capy')).toBe('idle');
  });

  it('pairs a question with its answer, and the asker looks at the answerer meanwhile', () => {
    const asked: CanonicalEvent = { ...base, id: 'e1', type: 'bot.asked', askId: 'k1', fromBotId: 'bot_onca', toBotId: 'bot_tamu', question: 'Per request?' };
    const waiting = foldEvents([asked, asked]);
    expect(waiting.items).toHaveLength(1);
    expect(pendingAsks(waiting)).toHaveLength(1);
    expect(gazeTargets(waiting)).toEqual({ bot_onca: 'bot_tamu' });
    expect(botActivity(waiting, 'bot_tamu')).toBe('working');

    const answered = foldEvents([
      asked,
      { ...base, at: later(5), id: 'e2', type: 'bot.answered', askId: 'k1', fromBotId: 'bot_onca', toBotId: 'bot_tamu', answer: 'Yes' },
    ]);
    expect(answered.items[0] as ExchangeItem).toMatchObject({ question: 'Per request?', answer: 'Yes', answeredAt: later(5) });
    expect(gazeTargets(answered)).toEqual({});
    expect(botActivity(answered, 'bot_tamu')).toBe('idle');
  });

  it('keeps an answer whose question it never saw', () => {
    const state = foldEvents([{ ...base, id: 'e1', type: 'bot.answered', askId: 'k9', fromBotId: 'a', toBotId: 'b', answer: 'Late' }]);
    expect(state.items[0]).toMatchObject({ kind: 'exchange', question: '', answer: 'Late' });
  });

  it('records a handoff once and passes the baton', () => {
    const handoff: CanonicalEvent = { ...base, id: 'h1', type: 'handoff', fromBotId: 'bot_capy', toBotId: 'bot_tuca', note: 'Yours' };
    const state = foldEvents([handoff, handoff]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0] as HandoffItem).toMatchObject({ fromBotId: 'bot_capy', toBotId: 'bot_tuca', note: 'Yours' });
    expect(state.baton).toBe('bot_tuca');
  });

  it('adds one timeline row per created task, and members from room.members', () => {
    const state = foldEvents([
      { ...base, id: 't1', type: 'task.created', task: root },
      { ...base, id: 't2', type: 'task.created', task: root },
      { ...base, id: 't3', type: 'task.updated', task: { ...root, status: 'done' } },
      { ...base, id: 'm1', type: 'room.members', botIds: ['bot_capy', 'bot_onca'] },
    ]);
    expect(state.items).toEqual([{ kind: 'task', taskId: 'root', at }]);
    expect(state.members).toEqual(['bot_capy', 'bot_onca']);
  });

  it('marks the approving bot as waiting', () => {
    const state = foldEvents([
      { ...base, id: 'e1', runId: 'r1', type: 'run.started', botId: 'bot_tuca', engine: 'mock' },
      {
        ...base,
        id: 'e2',
        runId: 'r1',
        type: 'approval.requested',
        approval: { id: 'a1', runId: 'r1', threadId: 'room_1', botId: 'bot_tuca', kind: 'send', tool: 'gmail.send', summary: 's', args: {}, status: 'pending', createdAt: at },
      },
    ]);
    expect(botActivity(state, 'bot_tuca')).toBe('waiting');
    expect(state.activeRuns.r1).toEqual({ botId: 'bot_tuca', state: 'waiting_approval' });
  });
});

describe('app store', () => {
  const room = { thread: { id: 'room_1', botId: 'bot_capy', title: 'Acme', kind: 'room' as const, leadBotId: 'bot_capy', responder: 'lead' as const, createdAt: at, updatedAt: at }, memberIds: ['bot_capy', 'bot_onca'] };

  const withRoom = (): AppState => appReducer(initialAppState, { type: 'rooms-loaded', rooms: [room] });

  it('routes room events to the room and task events to the task store', () => {
    let state = withRoom();
    state = appReducer(state, { type: 'event', roomId: 'room_1', event: { ...base, id: 'e1', type: 'task.created', task: root } });
    state = appReducer(state, { type: 'event', event: { ...base, id: 'e2', type: 'task.updated', task: { ...root, status: 'in_progress', updatedAt: later(1) } } });
    expect(state.roomThreads.room_1?.items).toHaveLength(1);
    expect(state.tasks.root?.status).toBe('in_progress');
  });

  it('never lets an older task copy replace a newer one', () => {
    let state = appReducer(initialAppState, { type: 'task-saved', task: { ...root, status: 'done', updatedAt: later(10) } });
    state = appReducer(state, { type: 'tasks-loaded', tasks: [{ ...root, status: 'open' }] });
    expect(state.tasks.root?.status).toBe('done');
  });

  it('updates members from room.members and derives room and bot status', () => {
    let state = withRoom();
    state = appReducer(state, { type: 'event', roomId: 'room_1', event: { ...base, id: 'm', type: 'room.members', botIds: ['bot_capy', 'bot_onca', 'bot_tamu'] } });
    expect(membersOf(state, 'room_1')).toEqual(['bot_capy', 'bot_onca', 'bot_tamu']);
    expect(state.rooms[0]?.memberIds).toHaveLength(3);

    state = appReducer(state, { type: 'event', roomId: 'room_1', event: { ...base, id: 'r', runId: 'r1', type: 'run.started', botId: 'bot_onca', engine: 'mock' } });
    expect(statusOfRoom(state, 'room_1')).toBe('working');
    expect(statusOfBot(state, 'bot_onca')).toBe('working');
    expect(statusOfBot(state, 'bot_capy')).toBe('idle');
  });

  it('selects the room and the board', () => {
    const state = appReducer(withRoom(), { type: 'select', selection: { kind: 'room', id: 'room_1' } });
    expect(state.selection).toEqual({ kind: 'room', id: 'room_1' });
    expect(appReducer(state, { type: 'select', selection: { kind: 'tasks' } }).selection).toEqual({ kind: 'tasks' });
  });
});

describe('task helpers', () => {
  const child = task('child', { parentTaskId: 'root' });
  const grandchild = task('grand', { parentTaskId: 'child', depth: 2, assigneeBotId: 'bot_tamu', createdByBotId: 'bot_onca', threadId: 'thread_bot_onca' });
  const other = task('other', { chainId: 'other', threadId: 'thread_bot_sol', assigneeBotId: 'bot_sol', status: 'blocked' });
  const index = { root, child, grand: grandchild, other };

  it('walks ancestors root first and lists children', () => {
    expect(ancestorsOf(index, grandchild).map((entry) => entry.id)).toEqual(['root', 'child']);
    expect(childrenOf(index, 'root').map((entry) => entry.id)).toEqual(['child']);
  });

  it('survives a parent cycle', () => {
    const a = task('a', { parentTaskId: 'b' });
    const b = task('b', { parentTaskId: 'a' });
    expect(ancestorsOf({ a, b }, a).map((entry) => entry.id)).toEqual(['b']);
  });

  it('filters by bot and by room chain', () => {
    expect(tasksForBot(index, 'bot_onca').map((entry) => entry.id).sort()).toEqual(['child', 'grand']);
    expect(tasksForRoom(index, 'room_1').map((entry) => entry.id).sort()).toEqual(['child', 'grand', 'root']);
  });

  it('groups by status', () => {
    const groups = groupByStatus(Object.values(index));
    expect(groups.open).toHaveLength(3);
    expect(groups.blocked.map((entry) => entry.id)).toEqual(['other']);
  });
});
