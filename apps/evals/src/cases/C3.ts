import { check, info, review } from '../checks';
import type { Case } from '../types';
import { botSpec } from './shared';

export const C3: Case = {
  id: 'C3',
  title: 'One stuck computer: kill Onça’s container mid-run; only her run fails and her files survive',
  status: 'now',
  async setup(ctx) {
    await ctx.createBot('onca', botSpec('onca', 'Long-running shell work', 'You run shell commands in your computer and report what happened.', []));
    await ctx.createBot('tuca', botSpec('tuca', 'Quick answers', 'You answer briefly.', []));
    await ctx.ensureComputer('onca');
    await ctx.ensureComputer('tuca');
  },
  async run(ctx) {
    const onca = await ctx.resolveThread('onca:dm');
    const longRun = await ctx.say(
      'onca:dm',
      'Run this shell command and wait for it to finish, then reply DONE: for i in $(seq 1 120); do echo tick $i >> /workspace/progress.txt; sleep 1; done',
    );
    if (longRun === null) throw new Error('Onça did not start a run');
    await ctx.waitFor('Onça to start writing progress', async () => (await ctx.exec('onca', 'test -s progress.txt && echo yes')).stdout.includes('yes'));
    await ctx.exec('onca', 'echo marker > c3-marker.txt');

    const tucaRun = await ctx.sayAndWait('tuca:dm', 'Reply with the single word PONG.');
    await ctx.killComputer('onca');
    const crashed = await ctx.waitRun(onca, longRun);
    ctx.notes.crashedRun = { status: crashed.status, error: crashed.error ?? '' };
    ctx.notes.tucaRun = tucaRun === null ? 'none' : (await ctx.waitRun(await ctx.resolveThread('tuca:dm'), tucaRun)).status;

    const after = await ctx.sayAndWait('onca:dm', 'Reply with the single word READY.');
    ctx.notes.afterRun = after === null ? 'none' : (await ctx.waitRun(onca, after)).status;
    ctx.probes.marker = (await ctx.exec('onca', 'cat c3-marker.txt')).stdout.trim();
  },
  check(evidence) {
    const crashed = (evidence.notes.crashedRun ?? { status: '', error: '' }) as { status: string; error: string };
    const tucaRun = String(evidence.notes.tucaRun ?? '');
    const afterRun = String(evidence.notes.afterRun ?? '');
    const computerErrors = evidence.events.filter((event) => event.type === 'computer.status' && event.state === 'error');
    return [
      check('onca-run-failed', 'Onça’s run failed when her computer died', crashed.status === 'failed', `status ${crashed.status}`),
      check('failure-has-reason', 'The failed run carries a reason', crashed.error.trim() !== '', crashed.error || 'no reason recorded'),
      review('reason-is-clear', 'Is the failure reason clear to a person?', crashed.error || 'no reason'),
      check('tuca-unaffected', 'Tuca’s run in parallel completed', tucaRun === 'completed', `status ${tucaRun}`),
      check('workspace-survives', 'Onça’s workspace file survived the kill and the restart', evidence.probes.marker === 'marker', `marker: ${String(evidence.probes.marker ?? '')}`),
      check('recovers', 'Onça answers again after the restart', afterRun === 'completed', `status ${afterRun}`),
      info('computer-errors', 'computer.status error events', String(computerErrors.length)),
    ];
  },
};
