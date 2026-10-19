import type { RunStatus } from '@brot/protocol';

/** Which delegation chain a run belongs to, so limits and budgets apply across bots. */
export interface ChainRef {
  chainId: string;
  depth: number;
  /** ask_bot hops taken so far in this chain. */
  askHops: number;
}

export interface BotRunRequest {
  botId: string;
  threadId: string;
  input: string;
  /** The bot that caused this run, when a bot did. Shown as "author → recipient" in the thread. */
  fromBotId?: string;
  chain?: ChainRef;
}

export interface BotRunOutcome {
  runId: string;
  status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>;
  /** The final assistant text of the run. */
  text: string;
  error?: string;
}

/** What the team tools need from the harness. Implemented by the harness, consumed by `team/`. */
export interface TeamRunner {
  /** Starts a run for `botId` and resolves when it settles. Approvals inside it still wait for a human. */
  runBot(req: BotRunRequest): Promise<BotRunOutcome>;
  /** Starts a run without waiting (delegated tasks). */
  startBot(req: BotRunRequest): Promise<{ runId: string }>;
  /** The chain the given run belongs to, if any. */
  chainOf(runId: string): ChainRef | undefined;
}
