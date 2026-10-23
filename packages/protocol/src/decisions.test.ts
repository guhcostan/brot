import { describe, expect, it } from 'vitest';
import { Decision, DecisionQuery } from './decisions';

const at = '2026-10-22T20:00:00.000Z';

const decision = {
  id: 'apr_1',
  runId: 'run_1',
  threadId: 't1',
  botId: 'bot_1',
  kind: 'send' as const,
  tool: 'send_email',
  summary: 'Send the invoice',
  decision: 'allow_once' as const,
  decidedAt: at,
};

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

describe('Decision', () => {
  it('round-trips a decision through JSON, with and without a reply', () => {
    expect(roundTrip(Decision, decision)).toEqual(decision);
    expect(roundTrip(Decision, { ...decision, decision: 'deny', reply: 'Not this one' })).toEqual({
      ...decision,
      decision: 'deny',
      reply: 'Not this one',
    });
  });

  it('requires a decision and a decidedAt, and carries no args', () => {
    expect(() => Decision.parse({ ...decision, decision: undefined })).toThrow();
    expect(() => Decision.parse({ ...decision, decidedAt: undefined })).toThrow();
    expect(() => Decision.parse({ ...decision, decision: 'maybe' })).toThrow();
    expect(Decision.parse({ ...decision, args: { secret: 'x' } })).not.toHaveProperty('args');
  });
});

describe('DecisionQuery', () => {
  it('defaults the limit to 50 and coerces a query-string limit', () => {
    expect(DecisionQuery.parse({})).toEqual({ limit: 50 });
    expect(DecisionQuery.parse({ limit: '10' }).limit).toBe(10);
    expect(DecisionQuery.parse({ limit: 200 }).limit).toBe(200);
  });

  it('rejects a limit outside 1..200 and a non-integer', () => {
    expect(() => DecisionQuery.parse({ limit: '0' })).toThrow();
    expect(() => DecisionQuery.parse({ limit: '201' })).toThrow();
    expect(() => DecisionQuery.parse({ limit: 'abc' })).toThrow();
    expect(() => DecisionQuery.parse({ limit: '1.5' })).toThrow();
  });

  it('validates the bounds, bot and decision filters', () => {
    expect(DecisionQuery.parse({ from: at, to: at, botId: 'bot_1', decision: 'deny' })).toEqual({
      from: at,
      to: at,
      botId: 'bot_1',
      decision: 'deny',
      limit: 50,
    });
    expect(() => DecisionQuery.parse({ from: 'yesterday' })).toThrow();
    expect(() => DecisionQuery.parse({ decision: 'maybe' })).toThrow();
    expect(() => DecisionQuery.parse({ botId: '' })).toThrow();
  });
});
