import { randomUUID } from 'node:crypto';
import { AskBotInput, TEAM_MAX_ASK_HOPS } from '@brot/protocol';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall } from '../mcp/types';
import { chainBudgetSpent, errorMessage, postBotMessage, resolveBot, type TeamDeps } from './context';
import type { BotRunOutcome, ChainRef } from './types';

const MAX_ANSWER_CHARS = 8000;

interface AskFrame {
  askId: string;
  fromBotId: string;
  toBotId: string;
}

/**
 * The `ask_bot` calls in flight, per chain. Each call waits for its answer, so the callers and targets of
 * the frames form the ask path, and a new question may not loop back into it.
 */
export interface AskLedger {
  path(chainId: string): Set<string>;
  begin(chainId: string, frame: AskFrame): void;
  end(chainId: string, askId: string): void;
}

export function createAskLedger(): AskLedger {
  const framesByChain = new Map<string, AskFrame[]>();
  return {
    path(chainId) {
      const members = new Set<string>();
      for (const frame of framesByChain.get(chainId) ?? []) {
        members.add(frame.fromBotId);
        members.add(frame.toBotId);
      }
      return members;
    },
    begin(chainId, frame) {
      framesByChain.set(chainId, [...(framesByChain.get(chainId) ?? []), frame]);
    },
    end(chainId, askId) {
      const remaining = (framesByChain.get(chainId) ?? []).filter((frame) => frame.askId !== askId);
      if (remaining.length > 0) framesByChain.set(chainId, remaining);
      else framesByChain.delete(chainId);
    },
  };
}

/** Asks another bot a question in the caller's thread and returns its answer. Waits for the answer. */
export function createAskBotTool(deps: TeamDeps, ledger: AskLedger): BrotTool {
  return {
    spec: {
      name: 'ask_bot',
      description:
        'Ask another bot a quick question you need answered before you can continue, and wait for its answer. Never ask a bot something this chain has already asked. Give exactly one of botId or botName.',
      inputSchema: inputSchemaOf(AskBotInput),
      risk: 'write',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = AskBotInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const resolved = await resolveBot(deps.repos, parsed.data);
      if ('error' in resolved) return resolved;
      const target = resolved.bot;
      if (target.id === scope.botId) return { error: 'A bot cannot ask itself. Answer from your own knowledge.' };

      const { question } = parsed.data;
      const callerChain = deps.runner.chainOf(scope.runId);
      const chain: ChainRef = callerChain ?? { chainId: randomUUID(), depth: 0, askHops: 0 };

      const refusal = await askRefusal(deps, ledger, chain, scope.botId, target.id, target.name);
      if (refusal) return { error: refusal };

      return {
        risk: 'write',
        kind: 'other',
        summary: `Ask ${target.name}: ${question}`.replace(/\s+/g, ' ').slice(0, 300),
        async run() {
          const refused = await askRefusal(deps, ledger, chain, scope.botId, target.id, target.name);
          if (refused) return { ok: false, output: refused };

          const askId = randomUUID();
          const callerName = (await deps.repos.bots.get(scope.botId))?.name ?? 'another bot';
          ledger.begin(chain.chainId, { askId, fromBotId: scope.botId, toBotId: target.id });
          try {
            await deps.bus.publish({
              type: 'bot.asked',
              threadId: scope.threadId,
              runId: scope.runId,
              askId,
              fromBotId: scope.botId,
              toBotId: target.id,
              question,
            });
            await postBotMessage(deps, {
              threadId: scope.threadId,
              runId: scope.runId,
              authorBotId: scope.botId,
              viaBotId: target.id,
              content: question,
            });

            let outcome: BotRunOutcome | undefined;
            let failure: string | undefined;
            try {
              outcome = await deps.runner.runBot({
                botId: target.id,
                threadId: scope.threadId,
                input: `${callerName} asks you: ${question}\n\nReply with your answer. ${callerName} is waiting for it.`,
                fromBotId: scope.botId,
                chain: { chainId: chain.chainId, depth: chain.depth, askHops: chain.askHops + 1 },
              });
            } catch (error) {
              failure = errorMessage(error);
            }

            const answered = outcome?.status === 'completed';
            const text =
              outcome?.status === 'completed'
                ? outcome.text
                : (outcome?.error ?? failure ?? `${target.name} ended without an answer (${outcome?.status ?? 'failed'}).`);
            const shown = truncateAnswer(text);
            await deps.bus.publish({
              type: 'bot.answered',
              threadId: scope.threadId,
              runId: scope.runId,
              askId,
              fromBotId: target.id,
              toBotId: scope.botId,
              answer: shown,
            });
            return answered ? { ok: true, output: shown } : { ok: false, output: `${target.name} did not answer. ${shown}` };
          } finally {
            ledger.end(chain.chainId, askId);
          }
        },
      };
    },
  };
}

/** Why a question may not run now, or undefined. Checked when the call is prepared and again before it runs. */
async function askRefusal(
  deps: TeamDeps,
  ledger: AskLedger,
  chain: ChainRef,
  callerId: string,
  targetId: string,
  targetName: string,
): Promise<string | undefined> {
  if (chain.askHops >= TEAM_MAX_ASK_HOPS) {
    return `This question would be hop ${chain.askHops + 1}; the limit is ${TEAM_MAX_ASK_HOPS} nested questions.`;
  }
  if (ledger.path(chain.chainId).has(targetId)) {
    return `${targetName} is already waiting on an answer in this exchange, so asking it again would loop.`;
  }
  if (await chainBudgetSpent(deps, chain.chainId, [callerId, targetId])) {
    return 'The team budget for this chain is spent, so no new work can start.';
  }
  return undefined;
}

function truncateAnswer(text: string): string {
  if (text.length <= MAX_ANSWER_CHARS) return text;
  return `${text.slice(0, MAX_ANSWER_CHARS)}\n\n[Answer truncated: showing the first ${MAX_ANSWER_CHARS} of ${text.length} characters.]`;
}
