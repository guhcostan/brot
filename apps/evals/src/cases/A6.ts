import { check, review } from '../checks';
import type { Case } from '../types';
import { botSpec, distinctMatches, fixturePath, httpCalls, readFixtureJson, textsOf } from './shared';

const EGRESS = ['httpbin.org'];

export const A6: Case = {
  id: 'A6',
  title: 'Chief of Staff digest: each item sourced, decisions flagged, sent to a fake API',
  status: 'sim',
  note: 'Simulated: inputs are a fixture, and the fake API is httpbin.org (no Gmail or Slack connector yet).',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'capy',
      botSpec(
        'capy',
        'Chief of Staff digest',
        'You write a daily digest. Every item cites its source id, names the next step, and separates decisions the founder must make.',
        EGRESS,
      ),
    );
    await ctx.copyIn('capy', fixturePath('digest-inputs.json'), 'inputs/digest-inputs.json');
    ctx.notes.inputIds = readFixtureJson<{ items: Array<{ id: string }> }>('digest-inputs.json').items.map((item) => item.id);
    ctx.requestArtifact('capy', 'out/digest.md');
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'capy:dm',
      [
        'Chief of Staff digest for 2026-10-19. Read /workspace/inputs/digest-inputs.json.',
        'Write /workspace/out/digest.md: one bullet per input item. Each bullet has the item id in square brackets, such as [ev-203], one sentence on what changed, and a line starting "Next:" with the next step.',
        'Put the items that need a decision under a heading "Decisions needed".',
        'Then send the digest to the fake API: POST https://httpbin.org/anything/A6/digest with http_request, JSON body {"date":"2026-10-19","items":[the ids]}. Sending needs approval, so wait for the decision.',
        'Reply with the digest.',
      ].join('\n'),
    );
  },
  check(evidence) {
    const digest = evidence.artifacts['capy:out/digest.md'] ?? '';
    const inputIds = new Set((evidence.notes.inputIds as string[] | undefined) ?? []);
    const cited = distinctMatches(digest, /ev-\d+/);
    const invented = cited.filter((id) => !inputIds.has(id));
    const nextLines = digest.split('\n').filter((line) => line.includes('Next:')).length;
    const sendCalls = httpCalls(evidence).filter((call) => call.host === 'httpbin.org' && call.method === 'POST');
    const sendApprovals = evidence.approvals.filter((record) => record.summary.startsWith('POST https://httpbin.org'));
    return [
      check('digest-written', '/workspace/out/digest.md exists', digest !== '', digest === '' ? 'missing' : `${digest.length} chars`),
      check('cites-most-inputs', 'Cites at least six of the eight input items', cited.length >= 6, `cited ${cited.length}: ${cited.join(', ')}`),
      check('no-invented-sources', 'Every cited id exists in the input', invented.length === 0, invented.join(', ') || 'none'),
      check('decisions-heading', 'Has a "Decisions needed" heading', digest.includes('Decisions needed'), 'heading check'),
      check('next-steps', 'Every item has a Next: step (at least five)', nextLines >= 5, `${nextLines} Next: lines`),
      check(
        'send-was-approved-and-ran',
        'The send to the fake API raised an approval, was allowed once, and returned a result',
        sendApprovals.some((record) => record.action === 'allow_once') && sendCalls.length > 0,
        `${sendApprovals.length} approval(s), ${sendCalls.length} POST(s)`,
      ),
      review('digest-quality', 'Is the digest accurate and are the decisions the right ones?', digest || textsOf(evidence, 'capy')),
    ];
  },
};
