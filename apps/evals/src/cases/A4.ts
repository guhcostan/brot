import { check, info, review } from '../checks';
import type { Case } from '../types';
import { botSpec, isTool, textsOf } from './shared';

const PAGES = {
  render: 'https://render.com/pricing',
  fly: 'https://docs.fly.io/about/pricing',
  netlify: 'https://www.netlify.com/pricing/',
} as const;
const EGRESS = ['render.com', 'docs.fly.io', 'www.netlify.com'];
const INSTRUCTION = [
  'Competitor Watch. For each page, in this order: render (https://render.com/pricing), fly (https://docs.fly.io/about/pricing), netlify (https://www.netlify.com/pricing/).',
  'Use curl in the shell (it goes through the egress proxy), not http_request: curl -fsSL <url> -o /workspace/snapshots/<slug>/current.txt, creating the folder first.',
  'Before saving, if current.txt exists, move it to previous.txt.',
  'Compare current.txt with previous.txt. Call notify_user ONLY for a material change: plan names, prices or limits that differ. If nothing material changed, do not call notify_user; write "no material change" to /workspace/snapshots/summary.txt.',
].join('\n');

export const A4: Case = {
  id: 'A4',
  title: 'Competitor Watch routine: snapshot three pricing pages, report only material changes',
  status: 'now',
  note: 'Routine, fired twice through POST /api/routines/:id/run instead of waiting for cron.',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'tamu',
      botSpec(
        'tamu',
        'Competitor Watch',
        'You track competitor pricing and changelog pages. You store snapshots and report only material changes, never noise.',
        EGRESS,
      ),
    );
    await ctx.createRoutine('watch', { botKey: 'tamu', name: 'A4 Competitor Watch', instruction: INSTRUCTION });
    await ctx.exec('tamu', 'mkdir -p snapshots');
    for (const slug of Object.keys(PAGES)) ctx.requestArtifact('tamu', `snapshots/${slug}/current.txt`);
  },
  async run(ctx) {
    const first = await ctx.runRoutine('watch');
    ctx.notes.run1 = first.id;
    const second = await ctx.runRoutine('watch');
    ctx.notes.run2 = second.id;
    const comparisons: Record<string, string> = {};
    for (const slug of Object.keys(PAGES)) {
      comparisons[slug] = (
        await ctx.exec('tamu', `cmp -s snapshots/${slug}/previous.txt snapshots/${slug}/current.txt && echo same || echo changed`)
      ).stdout.trim();
    }
    ctx.probes.comparisons = comparisons;
  },
  check(evidence) {
    const comparisons = (evidence.probes.comparisons ?? {}) as Record<string, string>;
    const allSame = Object.keys(PAGES).every((slug) => comparisons[slug] === 'same');
    const run2 = String(evidence.notes.run2 ?? '');
    const notifyInRun2 = evidence.events.filter(
      (event) => event.type === 'tool.call' && event.runId === run2 && isTool('notify_user', event.tool),
    ).length;
    const finalText = textsOf(evidence, 'tamu');
    const runsDone = evidence.runs.filter((run) => run.id === evidence.notes.run1 || run.id === run2);
    return [
      check(
        'two-routine-runs',
        'The routine ran twice and both runs settled',
        runsDone.length === 2 && runsDone.every((run) => run.status === 'completed'),
        runsDone.map((run) => run.status).join(', '),
      ),
      check(
        'snapshots-stored',
        'Every page has a current snapshot',
        Object.keys(PAGES).every((slug) => evidence.artifacts[`tamu:snapshots/${slug}/current.txt`]),
        Object.keys(PAGES).map((slug) => `${slug}: ${evidence.artifacts[`tamu:snapshots/${slug}/current.txt`] ? 'yes' : 'no'}`).join(', '),
      ),
      check(
        'unchanged-means-silent',
        'When no page changed between runs, the second run sent no notification',
        !allSame || notifyInRun2 === 0,
        `pages unchanged: ${allSame}; notify_user in run 2: ${notifyInRun2}`,
      ),
      info('comparisons', 'Snapshot comparison after run 2', JSON.stringify(comparisons)),
      review('summary-quality', 'Did the run describe real material changes correctly?', finalText),
    ];
  },
};
