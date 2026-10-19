import { TEAM_MAX_ASK_HOPS, TEAM_MAX_DEPTH } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createChainLedger } from './chains';

const root = { chainId: 'chain-1', depth: 0, askHops: 0 };

describe('chain ledger', () => {
  it('refuses a run past the depth or hop limits', () => {
    const ledger = createChainLedger();
    expect(() => ledger.assertCanStart({ ...root, depth: TEAM_MAX_DEPTH }, {})).not.toThrow();
    expect(() => ledger.assertCanStart({ ...root, depth: TEAM_MAX_DEPTH + 1 }, {})).toThrow(/depth/);
    expect(() => ledger.assertCanStart({ ...root, askHops: TEAM_MAX_ASK_HOPS }, {})).not.toThrow();
    expect(() => ledger.assertCanStart({ ...root, askHops: TEAM_MAX_ASK_HOPS + 1 }, {})).toThrow(/hops/);
  });

  it('remembers the chain of each run and what each run has cost', () => {
    const ledger = createChainLedger();
    ledger.enter('run-1', root, {});
    ledger.recordUsage('run-1', 0.1);
    ledger.recordUsage('run-1', 0.2);
    ledger.recordUsage('loose-run', 5);
    expect(ledger.chainOf('run-1')).toEqual(root);
    expect(ledger.chainOf('loose-run')).toBeUndefined();
    expect(ledger.spentUsd('chain-1')).toBeCloseTo(0.3);
  });

  it('stops new work in a chain once the smallest cap among its bots is spent', () => {
    const ledger = createChainLedger();
    ledger.enter('run-1', root, { teamBudgetUsd: 1 });
    ledger.recordUsage('run-1', 0.6);
    expect(() => ledger.assertCanStart(root, {})).not.toThrow();
    expect(() => ledger.assertCanStart(root, { teamBudgetUsd: 0.5 })).toThrow(/budget/);
    ledger.enter('run-2', root, { teamBudgetUsd: 0.7 });
    expect(() => ledger.assertCanStart(root, {})).not.toThrow();
    ledger.recordUsage('run-2', 0.1);
    expect(() => ledger.assertCanStart(root, {})).toThrow(/budget/);
    expect(() => ledger.assertCanStart({ ...root, chainId: 'other' }, {})).not.toThrow();
  });
});
