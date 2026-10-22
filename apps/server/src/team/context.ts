import type { Repos } from '@brot/db';
import type { Bot, TaskStatus } from '@brot/protocol';
import type { EventBus } from '../bus';
import type { TeamRunner } from './types';

export interface TeamDeps {
  repos: Repos;
  bus: EventBus;
  runner: TeamRunner;
  /** Stores the room's next responder when a handoff is accepted. Called before the `handoff` event. */
  onHandoff?: (threadId: string, toBotId: string) => void | Promise<void>;
}

export function isTerminal(status: TaskStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

export type ResolvedBot = { bot: Bot } | { error: string };

/** Finds an active bot by id, or by case-insensitive name. Unknown and ambiguous names are errors. */
export async function resolveBot(repos: Repos, ref: { botId?: string; botName?: string }): Promise<ResolvedBot> {
  if (ref.botId !== undefined) {
    const bot = await repos.bots.get(ref.botId);
    if (!bot || bot.archived) return { error: `No active bot has the id ${ref.botId}.` };
    return { bot };
  }
  const wanted = (ref.botName ?? '').trim().toLowerCase();
  const matches = (await repos.bots.list()).filter((bot) => bot.name.trim().toLowerCase() === wanted);
  const [first, ...rest] = matches;
  if (!first) return { error: `No active bot is named "${ref.botName ?? ''}". Call list_team to see the team.` };
  if (rest.length > 0) {
    const ids = matches.map((bot) => bot.id).join(', ');
    return { error: `"${ref.botName ?? ''}" matches ${matches.length} bots (${ids}). Name one with botId.` };
  }
  return { bot: first };
}

/** Stores a bot's message in a thread and announces it. */
export async function postBotMessage(
  deps: TeamDeps,
  input: { threadId: string; runId: string; authorBotId: string; viaBotId?: string; content: string },
): Promise<void> {
  const message = await deps.repos.messages.create({
    threadId: input.threadId,
    role: 'assistant',
    content: input.content,
    authorBotId: input.authorBotId,
    viaBotId: input.viaBotId,
  });
  await deps.bus.publish({ type: 'message.completed', threadId: input.threadId, runId: input.runId, message });
}

/** A runner that reports how much a chain has spent and what cap applies to it, so budgets can stop new work. */
export interface SpendAwareRunner extends TeamRunner {
  chainSpentUsd(chainId: string): number;
  chainCapUsd(chainId: string): number | undefined;
}

export function isSpendAware(runner: TeamRunner): runner is SpendAwareRunner {
  return 'chainSpentUsd' in runner && typeof runner.chainSpentUsd === 'function';
}

/**
 * True when the chain's team budget is spent. The cap is the smallest `teamBudgetUsd` among the given bots and every
 * bot that holds a task in the chain; without one, the runner's cap for the chain (a room's default) applies. A runner
 * that reports no spend never blocks.
 */
export async function chainBudgetSpent(deps: TeamDeps, chainId: string, botIds: string[]): Promise<boolean> {
  const { runner, repos } = deps;
  if (!isSpendAware(runner)) return false;
  const tasks = await repos.tasks.list({ chainId });
  const participants = new Set(botIds);
  for (const task of tasks) {
    participants.add(task.assigneeBotId);
    if (task.createdByBotId !== undefined) participants.add(task.createdByBotId);
  }
  let cap: number | undefined;
  for (const botId of participants) {
    const budget = (await repos.bots.get(botId))?.teamBudgetUsd;
    if (budget !== undefined && (cap === undefined || budget < cap)) cap = budget;
  }
  cap ??= runner.chainCapUsd(chainId);
  return cap !== undefined && runner.chainSpentUsd(chainId) >= cap;
}

/** The ask hops a run started in `chainId` inherits: its caller's when it stays in the same chain, else zero. */
export function inheritedAskHops(runner: TeamRunner, callerRunId: string, chainId: string): number {
  const chain = runner.chainOf(callerRunId);
  return chain?.chainId === chainId ? chain.askHops : 0;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
