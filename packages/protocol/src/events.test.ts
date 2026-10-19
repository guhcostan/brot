import { describe, expect, it } from 'vitest';
import { parseEvent } from './events';
import type { CanonicalEventType } from './events';

const at = '2026-10-19T12:00:00.000Z';
const base = { id: 'e1', at, threadId: 't1', runId: 'r1' };

const message = { id: 'm1', threadId: 't1', role: 'assistant', content: 'Hi', createdAt: at };
const approval = {
  id: 'a1',
  runId: 'r1',
  threadId: 't1',
  botId: 'bot_1',
  kind: 'send',
  tool: 'gmail.send',
  summary: 'Send email',
  args: {},
  status: 'pending',
  createdAt: at,
};
const memory = { id: 'mem1', botId: 'bot_1', kind: 'fact', content: 'x', createdAt: at, updatedAt: at };

const validEvents: Array<{ type: CanonicalEventType; event: Record<string, unknown> }> = [
  { type: 'run.started', event: { ...base, type: 'run.started', botId: 'bot_1', engine: 'mock' } },
  { type: 'message.delta', event: { ...base, type: 'message.delta', messageId: 'm1', delta: 'Hi' } },
  { type: 'message.completed', event: { ...base, type: 'message.completed', message } },
  { type: 'tool.call', event: { ...base, type: 'tool.call', callId: 'c1', tool: 'bash', args: { cmd: 'ls' } } },
  { type: 'tool.result', event: { ...base, type: 'tool.result', callId: 'c1', ok: true, output: 'done' } },
  { type: 'approval.requested', event: { ...base, type: 'approval.requested', approval } },
  {
    type: 'approval.resolved',
    event: { ...base, type: 'approval.resolved', approval: { ...approval, status: 'denied', decision: 'deny' } },
  },
  { type: 'memory.written', event: { ...base, type: 'memory.written', memory } },
  {
    type: 'cost.updated',
    event: { ...base, type: 'cost.updated', tokensIn: 1, tokensOut: 2, costUsd: 0.01 },
  },
  {
    type: 'computer.status',
    event: { ...base, type: 'computer.status', computerId: 'cmp_1', botId: 'bot_1', state: 'error', reason: 'pull failed' },
  },
  { type: 'network.blocked', event: { ...base, type: 'network.blocked', botId: 'bot_1', host: 'evil.example.com' } },
  { type: 'run.completed', event: { ...base, type: 'run.completed' } },
  { type: 'run.failed', event: { ...base, type: 'run.failed', error: 'boom' } },
];

describe('parseEvent', () => {
  for (const { type, event } of validEvents) {
    it(`accepts a valid ${type} event`, () => {
      expect(parseEvent(event).type).toBe(type);
    });
  }

  it('accepts an event without runId', () => {
    const noRun = { id: 'e1', at, threadId: 't1', type: 'run.completed' };
    expect(parseEvent(noRun)).toEqual(noRun);
  });

  it('rejects a computer.status with an unknown state', () => {
    expect(() =>
      parseEvent({ ...base, type: 'computer.status', computerId: 'cmp_1', botId: 'bot_1', state: 'paused' }),
    ).toThrow();
  });

  it('rejects a network.blocked that carries a URL instead of a host', () => {
    for (const host of ['https://evil.example.com', 'evil.example.com/path?token=x', 'evil.example.com user@x']) {
      expect(() => parseEvent({ ...base, type: 'network.blocked', botId: 'bot_1', host })).toThrow();
    }
  });

  it('rejects a network.blocked without a host', () => {
    expect(() => parseEvent({ ...base, type: 'network.blocked', botId: 'bot_1' })).toThrow();
  });

  it('rejects an unknown event type', () => {
    expect(() => parseEvent({ ...base, type: 'computer.frame' })).toThrow();
  });

  it('rejects an event with a missing payload field', () => {
    expect(() => parseEvent({ ...base, type: 'run.failed' })).toThrow();
  });

  it('rejects a non-ISO timestamp', () => {
    expect(() => parseEvent({ ...base, at: 'not-a-date', type: 'run.completed' })).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => parseEvent('run.completed')).toThrow();
    expect(() => parseEvent(null)).toThrow();
  });
});
