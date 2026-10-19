import { check, gap, info } from '../checks';
import type { Case } from '../types';
import { botSpec } from './shared';

const TURNS = 30;

export const C4: Case = {
  id: 'C4',
  title: 'Long thread: a 30-turn conversation still succeeds, and the context growth is visible',
  status: 'now',
  note: 'Reduced from 200 turns. gap: Brot has no context meter and no manual compaction (USE-CASES C4), so that part is recorded as a gap.',
  timeoutMs: 40 * 60_000,
  async setup(ctx) {
    await ctx.createBot('tamu', botSpec('tamu', 'Long conversation', 'You answer each message with exactly the requested number and nothing else.', []));
  },
  async run(ctx) {
    const runs: string[] = [];
    for (let turn = 1; turn <= TURNS; turn += 1) {
      const runId = await ctx.sayAndWait('tamu:dm', `Turn ${turn} of ${TURNS}. Reply with only the number ${turn * turn}.`);
      if (runId !== null) runs.push(runId);
    }
    ctx.notes.turnRuns = runs;
  },
  check(evidence) {
    const runs = (evidence.notes.turnRuns as string[] | undefined) ?? [];
    const byId = new Map(evidence.runs.map((run) => [run.id, run]));
    const completed = runs.filter((id) => byId.get(id)?.status === 'completed').length;
    const texts = new Map(evidence.finalTexts.map((entry) => [entry.runId, entry.text]));
    const correct = runs.filter((id, index) => (texts.get(id) ?? '').includes(String((index + 1) * (index + 1)))).length;
    const first = byId.get(runs[0] ?? '');
    const last = byId.get(runs[runs.length - 1] ?? '');
    return [
      check('all-turns-completed', `All ${TURNS} turns completed`, completed === TURNS, `${completed} of ${TURNS} completed`),
      check('answers-correct', 'At least 28 of 30 answers carry the right number', correct >= 28, `${correct} of ${TURNS} correct`),
      check(
        'context-grows',
        'Input tokens grow across the conversation (the history is sent every turn)',
        first !== undefined && last !== undefined && last.tokensIn > first.tokensIn,
        `turn 1 in ${first?.tokensIn ?? 'n/a'}, turn ${TURNS} in ${last?.tokensIn ?? 'n/a'}`,
      ),
      gap('context-meter', 'The user can see the context size and compaction', 'no context meter or compaction event in the API or the event log'),
      info('spend', 'Spend for the thread', `$${evidence.runs.reduce((sum, run) => sum + run.costUsd, 0).toFixed(4)}`),
    ];
  },
};
