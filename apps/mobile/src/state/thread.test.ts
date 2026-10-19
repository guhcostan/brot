import { describe, expect, it } from 'vitest';
import { activeRun, applyThreadEvent, initThread, latestThread, pendingApprovals, showTyping, timeline, type ThreadState } from './thread';
import { approval, at, event, message } from '../testing';

const fold = (state: ThreadState, ...events: Parameters<typeof applyThreadEvent>[1][]) => events.reduce(applyThreadEvent, state);

describe('thread state', () => {
  it('streams deltas into a draft, then replaces it with the completed message', () => {
    let state = initThread('th1', { messages: [message({ id: 'u1', role: 'user', content: 'hello', createdAt: at(0) })] });
    state = fold(
      state,
      event({ type: 'run.started', runId: 'r1', botId: 'b1', engine: 'mock' }),
      event({ type: 'message.delta', runId: 'r1', messageId: 'm1', delta: 'Hel' }),
      event({ type: 'message.delta', runId: 'r1', messageId: 'm1', delta: 'lo!' }),
    );
    expect(state.drafts.m1?.content).toBe('Hello!');
    expect(showTyping(state)).toBe(false);

    state = fold(
      state,
      event({ type: 'message.completed', runId: 'r1', message: message({ id: 'm1', content: 'Hello!', createdAt: at(50) }) }),
      event({ type: 'run.completed', runId: 'r1' }),
    );
    expect(state.drafts).toEqual({});
    expect(timeline(state).map((item) => item.key)).toEqual(['m:u1', 'm:m1']);
    expect(activeRun(state)).toBeUndefined();
  });

  it('shows typing while a run works with nothing streamed yet', () => {
    const state = fold(initThread('th1'), event({ type: 'run.started', runId: 'r1', botId: 'b1', engine: 'mock' }));
    expect(showTyping(state)).toBe(true);
  });

  it('ignores other threads and repeated events', () => {
    const delta = event({ type: 'message.delta', runId: 'r1', messageId: 'm1', delta: 'a' });
    let state = fold(initThread('th1'), delta, delta);
    expect(state.drafts.m1?.content).toBe('a');
    state = fold(state, event({ threadId: 'other', type: 'message.delta', runId: 'r9', messageId: 'm9', delta: 'x' }));
    expect(state.drafts.m9).toBeUndefined();
  });

  it('tracks approvals and the run waiting on them', () => {
    const requested = approval({ id: 'a1', runId: 'r1' });
    let state = fold(
      initThread('th1'),
      event({ type: 'run.started', runId: 'r1', botId: 'b1', engine: 'mock' }),
      event({ type: 'approval.requested', runId: 'r1', approval: requested }),
    );
    expect(activeRun(state)?.status).toBe('waiting_approval');
    expect(showTyping(state)).toBe(false);
    expect(pendingApprovals(state).map((a) => a.id)).toEqual(['a1']);

    state = fold(state, event({ type: 'approval.resolved', runId: 'r1', approval: { ...requested, status: 'allowed', decision: 'allow_once' } }));
    expect(pendingApprovals(state)).toEqual([]);
    expect(activeRun(state)?.status).toBe('running');
  });

  it('pairs tool calls with their results', () => {
    const state = fold(
      initThread('th1'),
      event({ type: 'tool.call', runId: 'r1', callId: 'c1', tool: 'shell', args: { cmd: 'ls' } }),
      event({ type: 'tool.result', runId: 'r1', callId: 'c1', ok: true, output: 'a.txt' }),
      event({ type: 'tool.result', runId: 'r1', callId: 'unknown', ok: false, output: '' }),
    );
    expect(state.tools.c1?.result).toEqual({ ok: true, output: 'a.txt' });
    expect(Object.keys(state.tools)).toEqual(['c1']);
  });

  it('shows a failed run as an error line and drops its half-streamed draft', () => {
    const state = fold(
      initThread('th1'),
      event({ type: 'run.started', runId: 'r1', botId: 'b1', engine: 'mock' }),
      event({ type: 'message.delta', runId: 'r1', messageId: 'm1', delta: 'part' }),
      event({ type: 'run.failed', runId: 'r1', error: 'Stopped — the site asked for a sign-in.' }),
    );
    expect(state.drafts).toEqual({});
    const last = timeline(state).at(-1);
    expect(last?.kind).toBe('error');
  });

  it('seeds runs and only this thread’s approvals from history', () => {
    const state = initThread('th1', {
      runs: [{ id: 'r1', threadId: 'th1', botId: 'b1', status: 'running', engine: 'mock', startedAt: at(0), tokensIn: 0, tokensOut: 0, costUsd: 0 }],
      approvals: [approval({ id: 'a1' }), approval({ id: 'a2', threadId: 'th2' })],
    });
    expect(activeRun(state)?.id).toBe('r1');
    expect(Object.keys(state.approvals)).toEqual(['a1']);
  });
});

describe('latestThread', () => {
  it('picks the most recently updated thread', () => {
    const threads = [
      { id: 'a', updatedAt: at(1) },
      { id: 'b', updatedAt: at(5) },
      { id: 'c', updatedAt: at(3) },
    ];
    expect(latestThread(threads)?.id).toBe('b');
    expect(latestThread([])).toBeUndefined();
  });
});
