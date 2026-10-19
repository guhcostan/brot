import type { Harness } from '../harness';
import type { BotRunOutcome, BotRunRequest, ChainRef, TeamRunner } from '../team/types';
import type { ChainLedger } from './chains';

/** The harness-backed `TeamRunner`, plus the chain budget that only this server tracks. */
export interface TeamRunnerService extends TeamRunner {
  /** What the chain has cost so far, in USD. */
  chainSpentUsd(chainId: string): number;
}

export function createTeamRunner(deps: { harness: () => Harness; chains: ChainLedger }): TeamRunnerService {
  return {
    async runBot(req: BotRunRequest): Promise<BotRunOutcome> {
      const started = await deps.harness().startBotRun(req);
      return started.settled;
    },

    async startBot(req: BotRunRequest): Promise<{ runId: string }> {
      const started = await deps.harness().startBotRun(req);
      return { runId: started.runId };
    },

    chainOf(runId: string): ChainRef | undefined {
      return deps.chains.chainOf(runId);
    },

    chainSpentUsd(chainId: string): number {
      return deps.chains.spentUsd(chainId);
    },
  };
}
