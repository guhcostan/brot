import { TEAM_MAX_ASK_HOPS, TEAM_MAX_DEPTH } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createChainLedger, DEFAULT_ROOM_CHAIN_BUDGET_USD, readRoomChainBudgetUsd } from './chains';

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

describe('room budget', () => {
  it('caps a chain that started in a room at the room budget when no bot sets one', () => {
    const ledger = createChainLedger({ roomBudgetUsd: 0.5 });
    ledger.enter('room-run', root, {}, true);
    expect(ledger.capUsd('chain-1')).toBe(0.5);
    ledger.recordUsage('room-run', 0.5);
    expect(() => ledger.assertCanStart(root, {})).toThrow(/budget/);
    expect(() => ledger.assertCanStart({ ...root, chainId: 'other' }, {})).not.toThrow();
  });

  it('keeps the room budget for later runs of a room chain, even when they start outside the room', () => {
    const ledger = createChainLedger({ roomBudgetUsd: 0.5 });
    ledger.enter('spent-run', root, {}, true);
    ledger.recordUsage('spent-run', 0.5);
    expect(() => ledger.assertCanStart(root, {}, true)).toThrow(/budget/);
    expect(() => ledger.assertCanStart(root, {}, false)).toThrow(/budget/);
  });

  it('lets a bot cap in the chain replace the room budget, higher or lower', () => {
    const ledger = createChainLedger({ roomBudgetUsd: 0.5 });
    ledger.enter('room-run', root, { teamBudgetUsd: 2 }, true);
    expect(ledger.capUsd('chain-1')).toBe(2);
    ledger.recordUsage('room-run', 1);
    expect(() => ledger.assertCanStart(root, {}, true)).not.toThrow();

    const low = createChainLedger({ roomBudgetUsd: 0.5 });
    low.enter('room-run', root, { teamBudgetUsd: 0.2 }, true);
    low.recordUsage('room-run', 0.3);
    expect(low.capUsd('chain-1')).toBe(0.2);
    expect(() => low.assertCanStart(root, {}, true)).toThrow(/budget/);
  });

  it('charges a delegated chain to the budget of the chain that delegated it', () => {
    const ledger = createChainLedger({ roomBudgetUsd: 1 });
    ledger.enter('room-run', root, {}, true);
    ledger.linkBudget('task-chain', 'chain-1');
    const task = { chainId: 'task-chain', depth: 1, askHops: 0 };
    ledger.enter('task-run', task, {});
    ledger.recordUsage('task-run', 0.6);

    expect(ledger.spentUsd('task-chain')).toBeCloseTo(0.6);
    expect(ledger.spentUsd('chain-1')).toBeCloseTo(0.6);
    expect(ledger.capUsd('task-chain')).toBe(1);
    expect(() => ledger.assertCanStart(task, {})).not.toThrow();
    ledger.recordUsage('room-run', 0.5);
    expect(() => ledger.assertCanStart(task, {})).toThrow(/budget/);
    expect(() => ledger.assertCanStart(root, {}, true)).toThrow(/budget/);
  });

  it('resolves a chain delegated from a delegated chain to the room that started both', () => {
    const ledger = createChainLedger({ roomBudgetUsd: 1 });
    ledger.enter('room-run', root, {}, true);
    ledger.linkBudget('task-chain', 'chain-1');
    ledger.linkBudget('second-chain', 'task-chain');
    ledger.enter('second-run', { chainId: 'second-chain', depth: 2, askHops: 0 }, {});
    ledger.recordUsage('second-run', 1.2);
    expect(ledger.spentUsd('chain-1')).toBeCloseTo(1.2);
    expect(ledger.capUsd('second-chain')).toBe(1);
  });

  it('does not apply the room budget to a chain that never started in a room', () => {
    const ledger = createChainLedger({ roomBudgetUsd: 0.5 });
    ledger.enter('dm-run', root, {});
    ledger.recordUsage('dm-run', 5);
    expect(ledger.capUsd('chain-1')).toBeUndefined();
    expect(() => ledger.assertCanStart(root, {})).not.toThrow();
  });

  it('defaults the room budget to one dollar, and reads BROT_TEAM_CHAIN_BUDGET_USD', () => {
    expect(DEFAULT_ROOM_CHAIN_BUDGET_USD).toBe(1);
    expect(readRoomChainBudgetUsd(undefined)).toBe(1);
    expect(readRoomChainBudgetUsd(' ')).toBe(1);
    expect(readRoomChainBudgetUsd('2.5')).toBe(2.5);
    expect(readRoomChainBudgetUsd('0')).toBe(0);
    expect(() => readRoomChainBudgetUsd('-1')).toThrow(/BROT_TEAM_CHAIN_BUDGET_USD/);
    expect(() => readRoomChainBudgetUsd('lots')).toThrow(/BROT_TEAM_CHAIN_BUDGET_USD/);
  });
});
