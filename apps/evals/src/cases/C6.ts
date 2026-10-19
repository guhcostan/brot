import { check, review } from '../checks';
import { holdPolicy } from '../approvals';
import type { Case } from '../types';
import { botSpec } from './shared';
import { sleep } from '../util';

interface HeldApproval {
  runId: string;
  approvalId: string;
}

const LATE_CHECK_MS = 10_000;

export const C6: Case = {
  id: 'C6',
  title: 'Restart while a send waits for approval: the run is interrupted and the send never runs',
  status: 'now',
  note: 'Two phases. Phase 1 leaves the approval pending and stops; the operator restarts the server; phase 2 (--resume C6) checks.',
  resume: true,
  approvals: holdPolicy,
  async setup(ctx) {
    await ctx.createBot('preguica', botSpec('preguica', 'Sender', 'You send requests the user asks for with http_request, and you wait for approval.', ['httpbin.org']));
  },
  async run(ctx) {
    // The mock engine has no model, so it asks for the send through its `/tool` command, which raises an approval.
    const prompt =
      ctx.settings.engine === 'mock'
        ? '/tool http_request POST https://httpbin.org/anything/C6/send'
        : 'Send a POST request to https://httpbin.org/anything/C6/send with the JSON body {"hello":"brot"} using http_request, and tell me the response.';
    const runId = await ctx.say('preguica:dm', prompt);
    if (runId === null) throw new Error('the bot did not start a run');
    const botId = ctx.botRef('preguica').id;
    const pending = await ctx.waitFor('the send to wait for approval', async () =>
      (await ctx.api.approvals('pending')).find((approval) => approval.botId === botId && approval.runId === runId),
    );
    const held: HeldApproval = { runId, approvalId: pending.id };
    ctx.notes.resumeState = held;
    ctx.holdRequested = true;
    ctx.instructions = [
      'Stop the server (Ctrl-C on pnpm dev, or kill the process), start it again on the same BROT_HOME and port,',
      `then run: pnpm --filter @brot/evals start -- --base ${ctx.api.base} --engine ${ctx.settings.engine} --model ${ctx.settings.model} --out ${ctx.settings.outDir} --resume C6`,
    ].join(' ');
  },
  async resumeRun(ctx, state) {
    const held = state as HeldApproval;
    const threadId = await ctx.resolveThread('preguica:dm');
    ctx.notes.heldRunId = held.runId;
    const run = (await ctx.api.listRuns(threadId)).find((candidate) => candidate.id === held.runId);
    ctx.notes.runAfterRestart = run === undefined ? 'missing' : { status: run.status, error: run.error ?? '' };
    const approval = (await ctx.api.approvals()).find((candidate) => candidate.id === held.approvalId);
    ctx.notes.approvalAfterRestart = approval?.status ?? 'missing';
    await sleep(LATE_CHECK_MS);
    const late = await ctx.api.threadEvents(threadId);
    const executed = late.filter((event) => event.type === 'tool.result' && event.ok && event.runId === held.runId);
    ctx.notes.successfulResultsAfterRestart = executed.length;
  },
  check(evidence) {
    const run = (evidence.notes.runAfterRestart ?? { status: 'missing', error: '' }) as { status: string; error: string } | string;
    const status = typeof run === 'string' ? run : run.status;
    const error = typeof run === 'string' ? '' : run.error;
    const approvalStatus = String(evidence.notes.approvalAfterRestart ?? 'missing');
    const successes = Number(evidence.notes.successfulResultsAfterRestart ?? -1);
    const heldRunId = String(evidence.notes.heldRunId ?? '');
    const heldCalls = evidence.events.filter((event) => event.type === 'tool.call' && event.runId === heldRunId).length;
    return [
      check('run-interrupted', 'After the restart the run is failed, not waiting', status === 'failed', `status ${status}`),
      check('interruption-reason', 'The run says why it was interrupted (the server restarted)', /restart/i.test(error), error || 'no reason'),
      check('approval-not-executed', 'The held send never produced a successful result, even after 10 s', successes === 0, `successful results after restart: ${successes}`),
      check('approval-not-allowed', 'The approval was not allowed after the restart', approvalStatus !== 'allowed', `approval status ${approvalStatus}`),
      review(
        'stale-approval-card',
        'The approval card after a restart: still pending in the list, so a person sees a card that cannot run',
        `approval ${approvalStatus}; the run is ${status}. The held run started ${heldCalls} tool call(s) before the restart.`,
      ),
    ];
  },
};
