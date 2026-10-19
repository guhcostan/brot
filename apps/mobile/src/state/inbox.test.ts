import { describe, expect, it } from 'vitest';
import { applyInboxEvent, botRows, inboxApprovals, initInbox, rememberThread } from './inbox';
import { approval, at, bot, event, message } from '../testing';

describe('inbox state', () => {
  const bots = [
    bot({ id: 'b1', name: 'Lua', avatar: 'cloud:teal' }),
    bot({ id: 'b2', name: 'Caju' }),
    bot({ id: 'b3', name: 'Old', archived: true }),
    bot({ id: 'b4', name: 'Pinned', pinned: true }),
  ];

  it('puts pinned bots first, then bots waiting on you, and hides archived ones', () => {
    const state = initInbox(bots, [approval({ id: 'a1', botId: 'b2' }), approval({ id: 'a2', botId: 'b2', status: 'allowed' })]);
    const rows = botRows(state);
    expect(rows.map((row) => row.bot.id)).toEqual(['b4', 'b2', 'b1']);
    expect(rows[1]).toMatchObject({ status: 'waiting', statusLabel: 'Waiting for you', pending: 1 });
    expect(rows[2]?.avatar).toMatchObject({ species: 'preguica', color: 'teal' });
    expect(inboxApprovals(state).map((a) => a.id)).toEqual(['a1']);
  });

  it('follows a run from working to done with a preview', () => {
    let state = initInbox(bots, []);
    state = applyInboxEvent(state, event({ threadId: 't1', type: 'run.started', runId: 'r1', botId: 'b1', engine: 'mock' }));
    expect(botRows(state).find((row) => row.bot.id === 'b1')?.status).toBe('working');
    state = applyInboxEvent(
      state,
      event({ threadId: 't1', type: 'message.completed', runId: 'r1', message: message({ id: 'm', threadId: 't1', content: 'Booked the\n table.' }) }),
    );
    state = applyInboxEvent(state, event({ threadId: 't1', type: 'run.completed', runId: 'r1' }));
    const row = botRows(state).find((r) => r.bot.id === 'b1');
    expect(row).toMatchObject({ status: 'ok', preview: 'Booked the table.' });
    expect(botRows(state)[1]?.bot.id).toBe('b1');
  });

  it('moves approvals in and out of the waiting list', () => {
    let state = initInbox(bots, []);
    const pending = approval({ id: 'a1', botId: 'b1', threadId: 't1', createdAt: at(1) });
    state = applyInboxEvent(state, event({ threadId: 't1', type: 'approval.requested', runId: 'r1', approval: pending }));
    expect(inboxApprovals(state)).toHaveLength(1);
    state = applyInboxEvent(state, event({ threadId: 't1', type: 'run.completed', runId: 'r1' }));
    expect(botRows(state).find((r) => r.bot.id === 'b1')?.status).toBe('waiting');
    state = applyInboxEvent(
      state,
      event({ threadId: 't1', type: 'approval.resolved', runId: 'r1', approval: { ...pending, status: 'denied', decision: 'deny' } }),
    );
    expect(inboxApprovals(state)).toHaveLength(0);
    expect(botRows(state).find((r) => r.bot.id === 'b1')?.status).toBe('idle');
  });

  it('marks failures and ignores events from threads it cannot attribute', () => {
    let state = initInbox(bots, []);
    state = applyInboxEvent(state, event({ threadId: 'unknown', type: 'run.failed', runId: 'r', error: 'x' }));
    expect(state.activity).toEqual({});
    state = rememberThread(state, 't2', 'b2');
    state = applyInboxEvent(state, event({ threadId: 't2', type: 'run.failed', runId: 'r', error: 'Stopped' }));
    expect(botRows(state).find((r) => r.bot.id === 'b2')).toMatchObject({ status: 'error', preview: 'Stopped' });
  });

  it('keeps learned activity across a refresh', () => {
    let state = initInbox(bots, []);
    state = applyInboxEvent(state, event({ threadId: 't1', type: 'run.started', runId: 'r1', botId: 'b1', engine: 'mock' }));
    const refreshed = initInbox(bots, [], state);
    expect(refreshed.activity.b1?.status).toBe('working');
    expect(refreshed.threadBot.t1).toBe('b1');
  });
});
