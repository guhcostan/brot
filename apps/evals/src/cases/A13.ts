import { check, info } from '../checks';
import type { Case } from '../types';
import { botSpec, isTool } from './shared';

const EGRESS = ['www.githubstatus.com'];
const INSTRUCTION = [
  'Watch the GitHub status page. GET https://www.githubstatus.com/api/v2/status.json with http_request and read status.indicator.',
  'Compare it with /workspace/state/last.json, which holds {"indicator": "..."}. If the file does not exist, this is the first run: create the file and do not notify.',
  'After every run, write the new indicator to last.json.',
  'Call notify_user ONLY when the indicator differs from the stored one. Say the new indicator and the description. Otherwise do not notify.',
].join('\n');

const indicatorOf = (text: string | null): string | undefined => {
  if (text === null) return undefined;
  try {
    return (JSON.parse(text) as { indicator?: string }).indicator;
  } catch {
    return undefined;
  }
};

export const A13: Case = {
  id: 'A13',
  title: 'Status watcher routine: poll every run, notify only on a state change',
  status: 'now',
  note: 'Routine, fired twice through POST /api/routines/:id/run. The real schedule is every 15 minutes.',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'preguica',
      botSpec(
        'preguica',
        'Status watcher',
        'You watch a status page and notify the user only when the state changes. Quiet runs are the normal case.',
        EGRESS,
      ),
    );
    await ctx.createRoutine('watch', { botKey: 'preguica', name: 'A13 Status watcher', instruction: INSTRUCTION });
    ctx.requestArtifact('preguica', 'state/last.json');
  },
  async run(ctx) {
    const first = await ctx.runRoutine('watch');
    ctx.notes.run1 = first.id;
    ctx.notes.indicatorAfterRun1 = indicatorOf(await ctx.readWorkspace('preguica', 'state/last.json'));
    const second = await ctx.runRoutine('watch');
    ctx.notes.run2 = second.id;
  },
  check(evidence) {
    const state = evidence.artifacts['preguica:state/last.json'];
    const run1 = String(evidence.notes.run1 ?? '');
    const run2 = String(evidence.notes.run2 ?? '');
    const notifies = (run: string): number =>
      evidence.events.filter((event) => event.type === 'tool.call' && event.runId === run && isTool('notify_user', event.tool)).length;
    const unchanged = evidence.notes.indicatorAfterRun1 !== undefined && indicatorOf(state ?? null) === evidence.notes.indicatorAfterRun1;
    return [
      check('state-stored', 'last.json holds an indicator after the first run', indicatorOf(state ?? null) !== undefined, state ?? 'missing'),
      check('first-run-silent', 'The first run does not notify', notifies(run1) === 0, `${notifies(run1)} notify_user calls`),
      check(
        'unchanged-means-silent',
        'When the indicator did not change between runs, the second run did not notify',
        !unchanged || notifies(run2) === 0,
        `unchanged: ${unchanged}; notify_user in run 2: ${notifies(run2)}`,
      ),
      info('indicator', 'Indicator after run 1 and the stored one', `${evidence.notes.indicatorAfterRun1 ?? 'none'} / ${indicatorOf(state ?? null) ?? 'none'}`),
    ];
  },
};
