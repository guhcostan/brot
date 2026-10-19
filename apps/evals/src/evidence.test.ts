import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@brot/protocol';
import { appearsIn, auditDecisions, costByRun, linkApprovalToCall, sumCost } from './evidence';
import type { ApprovalRecord } from './types';

const at = (seconds: number): string => new Date(Date.UTC(2026, 9, 19, 10, 0, seconds)).toISOString();

const call = (id: string, seconds: number, args: Record<string, unknown>, tool = 'http_request', runId = 'run-1'): CanonicalEvent => ({
  id,
  type: 'tool.call',
  at: at(seconds),
  threadId: 'thread-1',
  runId,
  callId: id,
  tool,
  args,
});
const result = (callId: string, seconds: number, ok: boolean): CanonicalEvent => ({
  id: `r-${callId}-${seconds}`,
  type: 'tool.result',
  at: at(seconds),
  threadId: 'thread-1',
  runId: 'run-1',
  callId,
  ok,
  output: ok ? 'HTTP 200' : 'denied',
});

const record = (overrides: Partial<ApprovalRecord>): ApprovalRecord => ({
  approvalId: 'ap-1',
  caseId: 'C10',
  botId: 'bot-1',
  botKey: 'tuca',
  runId: 'run-1',
  threadId: 'thread-1',
  tool: 'http_request',
  kind: 'send',
  summary: 'POST https://x.com/collect',
  args: { method: 'POST', url: 'https://x.com/collect' },
  createdAt: at(1),
  seenAt: at(2),
  timeToAppearMs: 1000,
  action: 'deny',
  reason: 'external',
  decidedAt: at(3),
  ...overrides,
});

describe('linkApprovalToCall', () => {
  it('prefers a call with the same arguments in the same run', () => {
    const events = [
      call('c-other', 1, { method: 'GET', url: 'https://a.test' }),
      call('c-match', 1, { method: 'POST', url: 'https://x.com/collect' }),
      call('c-elsewhere', 1, { method: 'POST', url: 'https://x.com/collect' }, 'http_request', 'run-2'),
    ];
    expect(linkApprovalToCall(record({}), events)?.callId).toBe('c-match');
  });

  it('matches a prefixed tool name and falls back to the nearest call of that tool', () => {
    const events = [call('c-1', 0, { method: 'DELETE', url: 'https://y.test' }, 'brot.http_request')];
    expect(linkApprovalToCall(record({ args: { other: true } }), events)?.callId).toBe('c-1');
  });

  it('returns undefined when no call fits', () => {
    expect(linkApprovalToCall(record({ tool: 'bash' }), [call('c-1', 0, {})])).toBeUndefined();
  });
});

describe('auditDecisions', () => {
  it('passes when a denied call has only a failed result after the decision', () => {
    const events = [call('c-1', 1, { method: 'POST', url: 'https://x.com/collect' }), result('c-1', 4, false)];
    const audit = auditDecisions([record({ decidedAt: at(3) })], events);
    expect(audit).toEqual({ linked: 1, unlinked: 0, violations: [] });
  });

  it('flags a tool result that exists before the decision', () => {
    const events = [call('c-1', 1, { method: 'POST', url: 'https://x.com/collect' }), result('c-1', 2, true)];
    const audit = auditDecisions([record({ decidedAt: at(3), action: 'allow_once' })], events);
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0]?.detail).toContain('before the decision');
  });

  it('flags a successful result for a call that was never decided', () => {
    const events = [call('c-1', 1, { method: 'POST', url: 'https://x.com/collect' }), result('c-1', 5, true)];
    const audit = auditDecisions([record({ action: 'hold', decidedAt: undefined })], events);
    expect(audit.violations[0]?.detail).toContain('never decided');
  });

  it('counts approvals with no call as unlinked, not as violations', () => {
    const audit = auditDecisions([record({ tool: 'bash' })], []);
    expect(audit).toEqual({ linked: 0, unlinked: 1, violations: [] });
  });
});

describe('costs', () => {
  const cost = (runId: string, seconds: number, costUsd: number, tokensIn: number): CanonicalEvent => ({
    id: `cost-${runId}-${seconds}`,
    type: 'cost.updated',
    at: at(seconds),
    threadId: 'thread-1',
    runId,
    tokensIn,
    tokensOut: 1,
    costUsd,
  });

  it('takes the last running total of each run', () => {
    const events = [cost('run-1', 1, 0.01, 100), cost('run-1', 2, 0.03, 250), cost('run-2', 3, 0.02, 80)];
    expect(costByRun(events).get('run-1')).toEqual({ costUsd: 0.03, tokensIn: 250, tokensOut: 1 });
    expect(sumCost(events)).toEqual({ costUsd: 0.05, tokensIn: 330, tokensOut: 2 });
  });
});

describe('appearsIn', () => {
  it('finds a needle anywhere in nested values and ignores empty needles', () => {
    expect(appearsIn('EVAL-CANARY-1', { a: [{ b: 'x EVAL-CANARY-1 y' }] })).toBe(true);
    expect(appearsIn('EVAL-CANARY-1', { a: 'nothing' })).toBe(false);
    expect(appearsIn('', { a: 'anything' })).toBe(false);
  });
});

