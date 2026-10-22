import { describe, expect, it } from 'vitest';
import type { Attachment, CanonicalEvent } from '@brot/protocol';
import { botStatus, foldEvents, sumCost, type ApprovalItem, type MessageItem, type ToolItem } from './thread';

const at = '2026-10-19T12:00:00.000Z';
const base = { at, threadId: 't1', runId: 'r1' };

const attachment = (extra: Partial<Attachment> & Pick<Attachment, 'id'>): Attachment => ({
  name: 'receipt.png',
  mimeType: 'image/png',
  size: 2048,
  kind: 'image',
  createdAt: at,
  ...extra,
});

const approval = {
  id: 'a1',
  runId: 'r1',
  threadId: 't1',
  botId: 'bot_1',
  kind: 'send' as const,
  tool: 'gmail.send',
  summary: 'Send the follow-up',
  args: { to: 'ana@example.com' },
  status: 'pending' as const,
  createdAt: at,
};

describe('foldEvents', () => {
  it('streams deltas into one assistant message and settles it on completion', () => {
    const events: CanonicalEvent[] = [
      { ...base, id: 'e1', type: 'run.started', botId: 'bot_1', engine: 'mock' },
      { ...base, id: 'e2', type: 'message.delta', messageId: 'm1', delta: 'Hel' },
      { ...base, id: 'e3', type: 'message.delta', messageId: 'm1', delta: 'lo' },
      { ...base, id: 'e4', type: 'run.completed' },
    ];
    const state = foldEvents(events);
    expect(state.run).toBe('completed');
    expect(state.items).toEqual([
      expect.objectContaining({ kind: 'message', id: 'm1', role: 'assistant', content: 'Hello', streaming: false }),
    ]);
  });

  it('replaces a streamed message with the completed message', () => {
    const state = foldEvents([
      { ...base, id: 'e1', type: 'message.delta', messageId: 'm1', delta: 'draft' },
      {
        ...base,
        id: 'e2',
        type: 'message.completed',
        message: { id: 'm1', threadId: 't1', role: 'assistant', content: 'final', createdAt: at },
      },
    ]);
    const messages = state.items as MessageItem[];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ content: 'final', streaming: false });
  });

  it('pairs tool calls with their results', () => {
    const state = foldEvents([
      { ...base, id: 'e1', type: 'tool.call', callId: 'c1', tool: 'bash', args: { cmd: 'ls' } },
      { ...base, id: 'e2', type: 'tool.result', callId: 'c1', ok: false, output: 'denied' },
    ]);
    expect(state.items[0]).toMatchObject({ kind: 'tool', status: 'error', output: 'denied' } satisfies Partial<ToolItem>);
  });

  it('waits on an approval until it is resolved, then keeps the resolved record', () => {
    const waiting = foldEvents([{ ...base, id: 'e1', type: 'approval.requested', approval }]);
    expect(botStatus(waiting)).toBe('waiting');

    const resolved = foldEvents([
      { ...base, id: 'e1', type: 'approval.requested', approval },
      {
        ...base,
        id: 'e2',
        type: 'approval.resolved',
        approval: { ...approval, status: 'allowed', decision: 'allow_once', resolvedAt: at },
      },
    ]);
    expect(resolved.run).toBe('running');
    expect(resolved.items[0] as ApprovalItem).toMatchObject({ approval: { status: 'allowed', decision: 'allow_once' } });
    expect(botStatus(resolved)).toBe('working');
  });

  it('marks failed runs and keeps the error visible as a system notice', () => {
    const state = foldEvents([
      { ...base, id: 'e1', type: 'message.delta', messageId: 'm1', delta: 'partial' },
      { ...base, id: 'e2', type: 'run.failed', error: 'rate limited' },
    ]);
    expect(botStatus(state)).toBe('error');
    expect(state.items.at(-1)).toMatchObject({ kind: 'message', role: 'system', content: 'rate limited' });
    expect((state.items[0] as MessageItem).streaming).toBe(false);
  });

  it('keeps the latest cost per run and sums across runs', () => {
    const state = foldEvents([
      { ...base, id: 'e1', type: 'cost.updated', tokensIn: 10, tokensOut: 5, costUsd: 0.01 },
      { ...base, id: 'e2', type: 'cost.updated', tokensIn: 20, tokensOut: 8, costUsd: 0.02 },
      { ...base, runId: 'r2', id: 'e3', type: 'cost.updated', tokensIn: 1, tokensOut: 1, costUsd: 0.005 },
    ]);
    expect(sumCost(state)).toEqual({ tokensIn: 21, tokensOut: 9, costUsd: 0.025 });
  });

  it('keeps the attachments of a completed message', () => {
    const receipt = attachment({ id: 'att_1' });
    const state = foldEvents([
      {
        ...base,
        id: 'e1',
        type: 'message.completed',
        message: { id: 'm1', threadId: 't1', role: 'user', content: 'Receipt attached', createdAt: at, attachments: [receipt] },
      },
    ]);
    expect(state.items[0]).toMatchObject({ kind: 'message', id: 'm1', attachments: [receipt] });
  });

  it('drops an attachment-less streaming draft when the completed message carries one', () => {
    const receipt = attachment({ id: 'att_1', kind: 'file', mimeType: 'application/pdf', name: 'plan.pdf' });
    const state = foldEvents([
      { ...base, id: 'e1', type: 'message.delta', messageId: 'm1', delta: 'draft' },
      {
        ...base,
        id: 'e2',
        type: 'message.completed',
        message: { id: 'm1', threadId: 't1', role: 'user', content: 'Plan attached', createdAt: at, attachments: [receipt] },
      },
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ content: 'Plan attached', streaming: false, attachments: [receipt] });
  });

  it('does not duplicate items when an event is replayed', () => {
    const call = { ...base, id: 'e1', type: 'tool.call' as const, callId: 'c1', tool: 'bash', args: {} };
    const state = foldEvents([call, call]);
    expect(state.items).toHaveLength(1);
  });
});
