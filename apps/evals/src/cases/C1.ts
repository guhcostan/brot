import { check, info } from '../checks';
import type { Case } from '../types';
import { botSpec, eventsOfType } from './shared';

const BUDGET_USD = 0.05;
const MEMBERS = ['onca', 'tuca', 'tamu', 'lobo'] as const;
/** Upper bound on the room's spend: four bots at the budget, doubled for runs in flight when the budget is spent. */
const COST_BOUND_USD = MEMBERS.length * BUDGET_USD * 2;
/** `TEAM_MAX_TASKS_PER_CHAIN` and `TEAM_MAX_DEPTH` in packages/protocol/src/constants.ts. */
const MAX_TASKS_PER_CHAIN = 20;
const MAX_DEPTH = 3;

export const C1: Case = {
  id: 'C1',
  title: 'Loop guard: four bots review each other unattended; the guards must stop them',
  status: 'now',
  note: 'Unattended, up to the case time limit. Each bot has teamBudgetUsd 0.05.',
  timeoutMs: 15 * 60_000,
  async setup(ctx) {
    const prompt = 'You are in a review room. Review the other bots, by name, and ask them to review your answers with ask_bot. Keep going until everyone has reviewed everyone.';
    await ctx.createBot('onca', botSpec('onca', 'Reviewer, leads the room', prompt, [], { teamBudgetUsd: BUDGET_USD }));
    await ctx.createBot('tuca', botSpec('tuca', 'Reviewer', prompt, [], { teamBudgetUsd: BUDGET_USD }));
    await ctx.createBot('tamu', botSpec('tamu', 'Reviewer', prompt, [], { teamBudgetUsd: BUDGET_USD }));
    await ctx.createBot('lobo', botSpec('lobo', 'Reviewer', prompt, [], { teamBudgetUsd: BUDGET_USD }));
    await ctx.room('loop', { title: 'Review loop', members: [...MEMBERS], lead: 'onca' });
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'loop',
      'Each of you: review the answers the other three bots give to this question, what is one risk of shipping on Friday? Reply to each one by name. Keep going until everyone has reviewed everyone twice. Do not stop before the loop is finished.',
    );
  },
  check(evidence) {
    const created = eventsOfType(evidence, 'task.created').map((event) => event.task);
    const asks = eventsOfType(evidence, 'bot.asked');
    const perChain = new Map<string, number>();
    for (const task of created) perChain.set(task.chainId, (perChain.get(task.chainId) ?? 0) + 1);
    const maxTasks = Math.max(0, ...perChain.values());
    const maxDepth = Math.max(0, ...evidence.tasks.map((task) => task.depth));
    const costUsd = evidence.runs.reduce((sum, run) => sum + run.costUsd, 0);
    return [
      check('stopped-on-its-own', 'The room went quiet before the time limit', !evidence.timedOut, evidence.timedOut ? 'hit the time limit' : 'quiet on its own'),
      check('loop-exercised', 'The bots actually asked each other (the guard was tested)', asks.length >= 1, `${asks.length} bot.asked event(s)`),
      check('asks-bounded', 'Asks stayed under 40 for four bots', asks.length <= 40, `${asks.length} asks`),
      check('chain-size-bounded', `No chain holds more than ${MAX_TASKS_PER_CHAIN} tasks`, maxTasks <= MAX_TASKS_PER_CHAIN, `largest chain ${maxTasks}`),
      check('depth-bounded', `No task is deeper than ${MAX_DEPTH}`, maxDepth <= MAX_DEPTH, `deepest ${maxDepth}`),
      check('spend-bounded', `Total spend stayed under $${COST_BOUND_USD.toFixed(2)}`, costUsd <= COST_BOUND_USD, `$${costUsd.toFixed(4)} spent`),
      info('spend', 'Spend and runs for the room', `$${costUsd.toFixed(4)}, ${evidence.runs.length} run(s), ${created.length} task(s)`),
    ];
  },
};
