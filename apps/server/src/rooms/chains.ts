import { TEAM_MAX_ASK_HOPS, TEAM_MAX_DEPTH, type Bot } from '@brot/protocol';

/** The part of a bot the ledger reads: its cap for chains it takes part in. */
type Budgeted = Pick<Bot, 'teamBudgetUsd'>;
import type { ChainRef } from '../team/types';

/**
 * Limits and spend of delegation chains, kept in memory. A chain is every run and task that shares a
 * `chainId`. The depth and hop limits are checked when a run starts; the budget is the smallest
 * `teamBudgetUsd` among the bots that took part in the chain, and it stops new work once spent.
 */
export interface ChainLedger {
  /** Throws when a run in `chain` would exceed a depth or hop limit, or when the chain's budget is spent. */
  assertCanStart(chain: ChainRef, bot: Budgeted): void;
  /** Records that `runId` belongs to `chain` and that `bot` takes part in it. */
  enter(runId: string, chain: ChainRef, bot: Budgeted): void;
  /** Adds what a run has cost so far to its chain. Runs outside a chain are ignored. */
  recordUsage(runId: string, costUsd: number): void;
  chainOf(runId: string): ChainRef | undefined;
  spentUsd(chainId: string): number;
}

export function createChainLedger(): ChainLedger {
  const runChains = new Map<string, ChainRef>();
  const spent = new Map<string, number>();
  const caps = new Map<string, number>();

  function capFor(chainId: string, bot: Budgeted): number | undefined {
    const seen = [caps.get(chainId), bot.teamBudgetUsd].filter((cap): cap is number => cap !== undefined);
    return seen.length === 0 ? undefined : Math.min(...seen);
  }

  return {
    assertCanStart(chain, bot) {
      if (chain.depth > TEAM_MAX_DEPTH) {
        throw new Error(`a task may be at most depth ${TEAM_MAX_DEPTH}, not ${chain.depth}`);
      }
      if (chain.askHops > TEAM_MAX_ASK_HOPS) {
        throw new Error(`a question may nest at most ${TEAM_MAX_ASK_HOPS} hops deep, not ${chain.askHops}`);
      }
      const cap = capFor(chain.chainId, bot);
      const total = spent.get(chain.chainId) ?? 0;
      if (cap !== undefined && total >= cap) {
        throw new Error(`the team budget for this chain is spent ($${total.toFixed(4)} of $${cap.toFixed(4)})`);
      }
    },

    enter(runId, chain, bot) {
      runChains.set(runId, chain);
      const cap = capFor(chain.chainId, bot);
      if (cap !== undefined) caps.set(chain.chainId, cap);
    },

    recordUsage(runId, costUsd) {
      const chain = runChains.get(runId);
      if (!chain || costUsd === 0) return;
      spent.set(chain.chainId, (spent.get(chain.chainId) ?? 0) + costUsd);
    },

    chainOf(runId) {
      return runChains.get(runId);
    },

    spentUsd(chainId) {
      return spent.get(chainId) ?? 0;
    },
  };
}
