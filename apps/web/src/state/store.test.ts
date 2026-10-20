import { describe, expect, it } from 'vitest';
import type { Approval, Bot } from '@brot/protocol';
import { appReducer, inbox, initialAppState } from './store';
import { foldEvents } from './thread';

const at = '2026-10-19T09:00:00.000Z';
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

const approval = (id: string, botId: string, createdAt: string): Approval => ({
  id,
  runId: `run_${id}`,
  threadId: `thread_${botId}`,
  botId,
  kind: 'send',
  tool: 'gmail.send',
  summary: 'Send it',
  args: {},
  status: 'pending',
  createdAt,
});

describe('app store', () => {
  it('starts on a pinned bot that is not archived', () => {
    const state = appReducer(initialAppState, { type: 'bots-loaded', bots: [bot('a', { pinned: true, archived: true }), bot('b'), bot('c', { pinned: true })] });
    expect(state.selection).toEqual({ kind: 'bot', id: 'c' });
  });

  it('adds, updates and removes bots, and moves the selection off a deleted one', () => {
    let state = appReducer(initialAppState, { type: 'bots-loaded', bots: [bot('a'), bot('b')] });
    state = appReducer(state, { type: 'bot-saved', bot: bot('c') });
    state = appReducer(state, { type: 'bot-saved', bot: bot('a', { name: 'Renamed' }) });
    expect(state.bots.map((entry) => entry.name)).toEqual(['Renamed', 'b', 'c']);
    expect(state.threads.c).toBeDefined();
    state = appReducer(state, { type: 'bot-removed', botId: 'a' });
    expect(state.bots.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(state.selection).toEqual({ kind: 'bot', id: 'b' });
  });

  it('lists every pending approval once, newest first', () => {
    const older = approval('one', 'a', at);
    const newer = approval('two', 'b', '2026-10-19T10:00:00.000Z');
    const requested = (item: Approval) => ({ id: `e_${item.id}`, at: item.createdAt, threadId: item.threadId, type: 'approval.requested' as const, approval: item });
    const state = {
      ...initialAppState,
      threads: { a: foldEvents([requested(older)]), b: foldEvents([requested(newer)]) },
      roomThreads: { room: foldEvents([requested(newer)]) },
    };
    expect(inbox(state).map((entry) => entry.approval.id)).toEqual(['two', 'one']);
  });
});
