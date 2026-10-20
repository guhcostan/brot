import { TEAM_MAX_ASK_HOPS, TEAM_MAX_DEPTH, type Bot } from '@brot/protocol';
import type { ChainRef } from '../team/types';

/** The part of a bot the ledger reads: its cap for chains it takes part in. */
type Budgeted = Pick<Bot, 'teamBudgetUsd'>;

/** What a chain that started in a room may spend, when no bot in it sets `teamBudgetUsd`. */
export const DEFAULT_ROOM_CHAIN_BUDGET_USD = 1;

export interface ChainLedgerOptions {
  /** Cap for chains that start in a room, when no bot in the chain sets `teamBudgetUsd`. Default: 1 USD. */
  roomBudgetUsd?: number;
}

/**
 * Limits and spend of delegation chains, kept in memory. A chain is every run and task that shares a `chainId`. The
 * depth and hop limits are checked when a run starts. The budget is the smallest `teamBudgetUsd` among the bots that
 * took part in the chain. A chain that started in a room and has no such cap gets the room budget. A chain stops taking
 * new work once its spend reaches its cap.
 *
 * A task delegated from a run is a chain of its own, but its spend counts against the budget of the chain its caller
 * ran in (`linkBudget`), so a room's budget covers the work it hands out.
 */
export interface ChainLedger {
  /**
   * Throws when a run in `chain` would exceed a depth or hop limit, or when the chain's budget is spent. `inRoom` marks
   * a run that answers in a room.
   */
  assertCanStart(chain: ChainRef, bot: Budgeted, inRoom?: boolean): void;
  /** Records that `runId` belongs to `chain` and that `bot` takes part in it. */
  enter(runId: string, chain: ChainRef, bot: Budgeted, inRoom?: boolean): void;
  /** Adds what a run has cost so far to its chain's budget. Runs outside a chain are ignored. */
  recordUsage(runId: string, costUsd: number): void;
  /** Charges the spend of chain `chainId` to the budget of chain `budgetChainId`. */
  linkBudget(chainId: string, budgetChainId: string): void;
  chainOf(runId: string): ChainRef | undefined;
  /** What the chain's budget has spent so far, in USD. */
  spentUsd(chainId: string): number;
  /** The cap that applies to the chain's budget from the bots the ledger has seen, or the room budget. */
  capUsd(chainId: string): number | undefined;
}

export function createChainLedger(options: ChainLedgerOptions = {}): ChainLedger {
  const roomBudgetUsd = options.roomBudgetUsd ?? DEFAULT_ROOM_CHAIN_BUDGET_USD;
  const runChains = new Map<string, ChainRef>();
  /** A chain's spend and caps are kept under the chain whose budget it counts against. */
  const budgetOwner = new Map<string, string>();
  const spent = new Map<string, number>();
  /** The smallest `teamBudgetUsd` each budget has seen from its bots. */
  const botCaps = new Map<string, number>();
  /** Budgets of chains that started in a room. */
  const roomBudgets = new Set<string>();

  function budgetOf(chainId: string): string {
    return budgetOwner.get(chainId) ?? chainId;
  }

  function capFor(budget: string, bot: Budgeted | undefined, inRoom: boolean): number | undefined {
    const fromBots = smallest(botCaps.get(budget), bot?.teamBudgetUsd);
    if (fromBots !== undefined) return fromBots;
    return inRoom || roomBudgets.has(budget) ? roomBudgetUsd : undefined;
  }

  return {
    assertCanStart(chain, bot, inRoom = false) {
      if (chain.depth > TEAM_MAX_DEPTH) {
        throw new Error(`a task may be at most depth ${TEAM_MAX_DEPTH}, not ${chain.depth}`);
      }
      if (chain.askHops > TEAM_MAX_ASK_HOPS) {
        throw new Error(`a question may nest at most ${TEAM_MAX_ASK_HOPS} hops deep, not ${chain.askHops}`);
      }
      const budget = budgetOf(chain.chainId);
      const cap = capFor(budget, bot, inRoom);
      const total = spent.get(budget) ?? 0;
      if (cap !== undefined && total >= cap) {
        throw new Error(`the team budget for this chain is spent ($${total.toFixed(4)} of $${cap.toFixed(4)})`);
      }
    },

    enter(runId, chain, bot, inRoom = false) {
      runChains.set(runId, chain);
      const budget = budgetOf(chain.chainId);
      if (inRoom) roomBudgets.add(budget);
      const cap = smallest(botCaps.get(budget), bot.teamBudgetUsd);
      if (cap !== undefined) botCaps.set(budget, cap);
    },

    recordUsage(runId, costUsd) {
      const chain = runChains.get(runId);
      if (!chain || costUsd === 0) return;
      const budget = budgetOf(chain.chainId);
      spent.set(budget, (spent.get(budget) ?? 0) + costUsd);
    },

    linkBudget(chainId, budgetChainId) {
      const owner = budgetOf(budgetChainId);
      if (owner !== chainId) budgetOwner.set(chainId, owner);
    },

    chainOf(runId) {
      return runChains.get(runId);
    },

    spentUsd(chainId) {
      return spent.get(budgetOf(chainId)) ?? 0;
    },

    capUsd(chainId) {
      return capFor(budgetOf(chainId), undefined, false);
    },
  };
}

/** Reads `BROT_TEAM_CHAIN_BUDGET_USD`: a USD amount of 0 or more. Unset or blank means the default. */
export function readRoomChainBudgetUsd(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_ROOM_CHAIN_BUDGET_USD;
  const usd = Number(value);
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`BROT_TEAM_CHAIN_BUDGET_USD must be a USD amount of 0 or more, got "${value}"`);
  }
  return usd;
}

function smallest(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}
