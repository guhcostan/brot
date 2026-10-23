import { check, info } from '../checks';
import type { Case } from '../types';
import { botSpec } from './shared';

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TRIGGER = 'Reply with the single word PING.';

/**
 * Per-bot budget caps. Bot A has dailyBudgetUsd 0 (its run fails before any model call), bot B has runBudgetUsd 0
 * (its run starts and aborts when the first usage report crosses the cap), bot C is uncapped and answers.
 */
export const C2: Case = {
  id: 'C2',
  title: 'Per-bot budget caps stop a runaway bot, with cost per bot visible',
  status: 'now',
  note: 'Three dsh bots: daily cap 0, per-run cap 0, and no cap. Their runs fail or finish with a recorded cost per bot.',
  egress: [],
  async setup(ctx) {
    await ctx.createBot('onca', {
      ...botSpec('onca', 'Daily budget of zero', 'You answer briefly.', []),
      computer: 'none',
      dailyBudgetUsd: 0,
    });
    await ctx.createBot('tuca', {
      ...botSpec('tuca', 'Per-run budget of zero', 'You answer briefly.', []),
      computer: 'none',
      runBudgetUsd: 0,
    });
    await ctx.createBot('tamu', {
      ...botSpec('tamu', 'No budget cap', 'You answer briefly.', []),
      computer: 'none',
    });
  },
  async run(ctx) {
    const runOf = async (key: string, threadKey: string): Promise<{ status: string; error: string; costUsd: number }> => {
      const runId = await ctx.say(threadKey, TRIGGER);
      if (runId === null) throw new Error(`${key} did not start a run`);
      const run = await ctx.waitRun(await ctx.resolveThread(threadKey), runId);
      return { status: run.status, error: run.error ?? '', costUsd: run.costUsd };
    };
    ctx.notes.dailyRun = await runOf('onca', 'onca:dm');
    ctx.notes.runCapRun = await runOf('tuca', 'tuca:dm');
    ctx.notes.uncappedRun = await runOf('tamu', 'tamu:dm');
  },
  check(evidence) {
    const named = (key: string): string => escape(evidence.bots[key]?.name ?? key);
    const read = (key: string): { status: string; error: string; costUsd: number } => {
      const value = evidence.notes[key];
      return typeof value === 'object' && value !== null
        ? (value as { status: string; error: string; costUsd: number })
        : { status: '', error: '', costUsd: 0 };
    };
    const daily = read('dailyRun');
    const runCap = read('runCapRun');
    const uncapped = read('uncappedRun');
    const dailyPattern = new RegExp(`^Daily budget for "${named('onca')}" is exhausted: spent \\$0 of \\$0 today\\.$`);
    const runPattern = new RegExp(`^Run budget for "${named('tuca')}" exceeded: spent \\$[\\d.]+ of \\$0\\.$`);

    const costByBot = new Map<string, number>();
    for (const run of evidence.runs) costByBot.set(run.botId, (costByBot.get(run.botId) ?? 0) + run.costUsd);
    const costs = Object.entries(evidence.bots)
      .map(([, bot]) => `${bot.name}: $${(costByBot.get(bot.id) ?? 0).toFixed(6)}`)
      .join(', ');

    return [
      check(
        'daily-cap-stops-the-run',
        'The daily-capped bot’s run failed with the daily-budget message',
        daily.status === 'failed' && dailyPattern.test(daily.error),
        `${daily.status}: ${daily.error || 'no error'}`,
      ),
      check('daily-cap-cost-zero', 'The daily-capped run spent $0 (it never reached the model)', daily.costUsd === 0, `$${daily.costUsd.toFixed(6)}`),
      check(
        'run-cap-stops-the-run',
        'The run-capped bot’s run failed with the run-budget message',
        runCap.status === 'failed' && runPattern.test(runCap.error),
        `${runCap.status}: ${runCap.error || 'no error'}`,
      ),
      check('run-cap-recorded-spend', 'The run-capped run aborted on its first usage report, with its cost on record', runCap.costUsd > 0, `$${runCap.costUsd.toFixed(6)}`),
      check('uncapped-completes', 'The uncapped bot’s tiny run completed', uncapped.status === 'completed', `${uncapped.status}: ${uncapped.error || 'ok'}`),
      check('uncapped-cost-recorded', 'The uncapped bot’s cost is recorded per run', uncapped.costUsd > 0, `$${uncapped.costUsd.toFixed(6)}`),
      info('cost-per-bot', 'Cost per bot, from the run records', costs),
    ];
  },
  async cleanup(ctx) {
    for (const bot of ctx.bots.values()) await ctx.api.deleteBot(bot.id).catch(() => undefined);
    ctx.bots.clear();
  },
};
