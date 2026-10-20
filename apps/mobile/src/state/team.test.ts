import { describe, expect, it } from 'vitest';
import { applyInboxEvent, botRows, initInbox, roomRows, takeoverRequests, withComputer, withRooms } from './inbox';
import { applyThreadEvent, batonHolder, initThread, timeline, typingBots, withHistory, type ThreadState } from './thread';
import { at, bot, event, message, T0 } from '../testing';

const fold = (state: ThreadState, ...events: Parameters<typeof applyThreadEvent>[1][]) => events.reduce(applyThreadEvent, state);
const room = { id: 'room1', botId: 'b1', leadBotId: 'b1', kind: 'room' as const, responder: 'lead' as const, title: 'Launch', createdAt: T0, updatedAt: T0 };

describe('room thread state', () => {
  it('tracks asks, answers, handoffs and who is typing', () => {
    let state = initThread('room1');
    state = fold(
      state,
      event({ threadId: 'room1', type: 'run.started', runId: 'r1', botId: 'b1', engine: 'mock' }),
      event({ threadId: 'room1', type: 'run.started', runId: 'r2', botId: 'b2', engine: 'mock' }),
      event({ threadId: 'room1', type: 'message.delta', runId: 'r1', messageId: 'm1', delta: 'On it' }),
      event({ threadId: 'room1', type: 'bot.asked', fromBotId: 'b1', toBotId: 'b2', question: 'Price?', askId: 'q1' }),
      event({ threadId: 'room1', type: 'bot.answered', askId: 'q1', fromBotId: 'b2', toBotId: 'b1', answer: 'R$ 40' }),
      event({ threadId: 'room1', type: 'handoff', fromBotId: 'b1', toBotId: 'b2', note: 'your turn' }),
    );
    expect(typingBots(state)).toEqual(['b2']);
    expect(state.asks.q1).toMatchObject({ question: 'Price?', answer: 'R$ 40' });
    expect(batonHolder(state)).toBe('b2');
    expect(timeline(state).map((item) => item.kind)).toEqual(['draft', 'ask', 'handoff']);
  });

  it('folds team events from the stored log without duplicating messages', () => {
    const history = [
      event({ threadId: 'room1', type: 'message.completed', message: message({ id: 'm1', threadId: 'room1' }) }),
      event({ threadId: 'room1', type: 'handoff', fromBotId: 'b1', toBotId: 'b3' }),
    ];
    const state = withHistory(initThread('room1', { messages: [message({ id: 'm1', threadId: 'room1' })] }), history);
    expect(state.messages).toHaveLength(1);
    expect(batonHolder(state)).toBe('b3');
  });
});

describe('inbox with rooms and desktops', () => {
  const bots = [bot({ id: 'b1', name: 'Capy' }), bot({ id: 'b2', name: 'Onça', computer: 'sandbox', desktop: true })];

  it('lists rooms with members lead first and attributes room events by run', () => {
    let state = withRooms(initInbox(bots, []), [room], { room1: ['b2', 'b1'] });
    state = applyInboxEvent(state, event({ threadId: 'room1', type: 'run.started', runId: 'r2', botId: 'b2', engine: 'mock' }));
    state = applyInboxEvent(state, event({ threadId: 'room1', type: 'message.completed', runId: 'r2', message: message({ id: 'm', threadId: 'room1', authorBotId: 'b2', content: 'Done' }) }));
    state = applyInboxEvent(state, event({ threadId: 'room1', type: 'run.completed', runId: 'r2' }));
    const [row] = roomRows(state);
    expect(row?.members.map((member) => member.id)).toEqual(['b1', 'b2']);
    expect(row).toMatchObject({ preview: 'Done', authorName: 'Onça' });
    expect(botRows(state).find((r) => r.bot.id === 'b2')?.status).toBe('ok');
    expect(botRows(state).find((r) => r.bot.id === 'b1')?.status).toBe('idle');
  });

  it('raises a takeover the bot asked for and drops it when control comes back', () => {
    let state = initInbox(bots, []);
    state = applyInboxEvent(state, event({ type: 'computer.takeover', takeover: { botId: 'b2', active: true, requestedBy: 'bot', reason: 'Sign in to the bank', at: at(1) } }));
    expect(takeoverRequests(state).map((t) => t.reason)).toEqual(['Sign in to the bank']);
    state = applyInboxEvent(state, event({ type: 'computer.takeover', takeover: { botId: 'b2', active: false, at: at(2) } }));
    expect(takeoverRequests(state)).toEqual([]);
    state = withComputer(state, 'b2', { state: 'ready', takeover: { botId: 'b2', active: true, requestedBy: 'user', at: at(3) } });
    expect(takeoverRequests(state)).toEqual([]);
    expect(state.computerState.b2).toBe('ready');
  });

  it('remembers the last browser tool per bot for the status line', () => {
    let state = initInbox(bots, []);
    state = applyInboxEvent(state, event({ threadId: 't2', type: 'run.started', runId: 'r1', botId: 'b2', engine: 'mock' }));
    state = applyInboxEvent(state, event({ threadId: 't2', type: 'tool.call', runId: 'r1', callId: 'c1', tool: 'mcp__brot__browser_open', args: { url: 'https://x.dev' } }));
    state = applyInboxEvent(state, event({ threadId: 't2', type: 'tool.call', runId: 'r1', callId: 'c2', tool: 'http_request', args: {} }));
    expect(state.computerActivity.b2?.tool).toBe('mcp__brot__browser_open');
  });
});
