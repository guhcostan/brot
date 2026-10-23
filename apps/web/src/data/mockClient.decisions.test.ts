import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_SEND } from './fixtures';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock decision log', () => {
  it('seeds denied, allow-always and allow-once decisions newest first', async () => {
    const client = createMockClient();
    const decisions = await client.listDecisions();

    expect(decisions.map((decision) => decision.decision)).toEqual(['deny', 'allow_always', 'allow_once']);
    expect(new Set(decisions.map((decision) => decision.botId)).size).toBeGreaterThanOrEqual(2);
    expect(decisions.some((decision) => decision.reply !== undefined)).toBe(true);
    const times = decisions.map((decision) => Date.parse(decision.decidedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('filters by outcome, bot and range', async () => {
    const client = createMockClient();
    await expect(client.listDecisions({ decision: 'deny' })).resolves.toMatchObject([{ decision: 'deny', botId: 'bot_tuca' }]);

    const capy = await client.listDecisions({ botId: 'bot_capy' });
    expect(capy.every((decision) => decision.botId === 'bot_capy')).toBe(true);

    const recent = await client.listDecisions({ from: new Date(Date.now() - 24 * 3_600_000).toISOString() });
    expect(recent).toHaveLength(1);
    expect(recent[0]?.decision).toBe('deny');

    const old = await client.listDecisions({ to: new Date(Date.now() - 24 * 3_600_000).toISOString() });
    expect(old.length).toBe(2);
    expect(old.every((decision) => decision.decision !== 'deny')).toBe(true);
  });

  it('honours the limit and multiple filters together', async () => {
    const client = createMockClient();
    const limited = await client.listDecisions({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.decision).toBe('deny');

    const none = await client.listDecisions({ botId: 'bot_capy', decision: 'deny' });
    expect(none).toEqual([]);

    await expect(client.listDecisions({ limit: 0 })).rejects.toThrow();
  });

  it('records a decision when an approval is resolved', async () => {
    vi.useRealTimers();
    const client = createMockClient();
    await client.resolveApproval(PENDING_SEND.id, { decision: 'allow_once', reply: 'Go ahead.' });

    const decisions = await client.listDecisions({ botId: PENDING_SEND.botId, decision: 'allow_once' });
    const recorded = decisions.find((decision) => decision.reply === 'Go ahead.');
    expect(recorded).toMatchObject({
      decision: 'allow_once',
      botId: PENDING_SEND.botId,
      tool: PENDING_SEND.tool,
      summary: PENDING_SEND.summary,
      reply: 'Go ahead.',
    });
  });

  it('returns the CSV export path with the same filters', async () => {
    const client = createMockClient();
    expect(client.decisionsExportUrl()).toBe('/api/decisions/export.csv');
    expect(client.decisionsExportUrl({ from: 'a', to: 'b', botId: 'bot_1', decision: 'deny' })).toBe(
      '/api/decisions/export.csv?from=a&to=b&botId=bot_1&decision=deny',
    );
  });
});
