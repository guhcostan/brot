import { check, info, review } from '../checks';
import type { Case } from '../types';
import { botSpec, FAKE_API_POLICY, fixturePath, httpCalls, readFixtureJson, textsOf } from './shared';

const EGRESS = ['httpbin.org'];

export const A8: Case = {
  id: 'A8',
  title: 'Invoice reminders: one reminder per overdue invoice, each send needs approval',
  status: 'sim',
  note: 'Simulated: invoices are a fixture and sends go to httpbin.org as the fake API.',
  egress: EGRESS,
  approvals: FAKE_API_POLICY,
  async setup(ctx) {
    await ctx.createBot(
      'tuca',
      botSpec(
        'tuca',
        'Invoice reminders',
        'You draft polite payment reminders for overdue invoices. Every reminder is sent only after the user approves it.',
        EGRESS,
      ),
    );
    await ctx.copyIn('tuca', fixturePath('invoices.json'), 'inputs/invoices.json');
    ctx.notes.expectedOverdue = readFixtureJson<{ overdueIds: string[] }>('invoices.key.json').overdueIds;
    ctx.requestArtifact('tuca', 'out/reminders.json');
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'tuca:dm',
      [
        'Invoice reminders. Read /workspace/inputs/invoices.json.',
        'For every invoice with status "overdue", draft one reminder and write /workspace/out/reminders.json: a JSON array of {"invoiceId","to","subject","body"}. The body is three polite sentences that name the amount and the days overdue.',
        'Then send each reminder with http_request: POST https://httpbin.org/anything/A8/reminders with the reminder as the JSON body. Each send needs the user approval, so wait for each decision.',
        'Do not send to invoices that are not overdue. Reply with the invoice ids you sent.',
      ].join('\n'),
    );
  },
  check(evidence) {
    const expected = [...((evidence.notes.expectedOverdue as string[] | undefined) ?? [])].sort();
    const raw = evidence.artifacts['tuca:out/reminders.json'];
    let reminders: Array<{ invoiceId: string }> = [];
    try {
      reminders = raw ? (JSON.parse(raw) as Array<{ invoiceId: string }>) : [];
    } catch {
      reminders = [];
    }
    const drafted = reminders.map((item) => item.invoiceId).sort();
    const sends = httpCalls(evidence).filter((call) => call.host === 'httpbin.org' && call.method === 'POST');
    const approvals = evidence.approvals.filter((record) => record.summary.startsWith('POST https://httpbin.org'));
    // A bot may batch several invoices into one POST. Then one approval covers that POST, and every invoice must still
    // be named by an approved send.
    const approvedBodies = approvals.filter((record) => record.action === 'allow_once').map((record) => String(record.args.body ?? ''));
    const uncovered = expected.filter((id) => !approvedBodies.some((body) => body.includes(id)));
    const batched = sends.filter((call) => expected.filter((id) => call.body.includes(id)).length > 1);
    return [
      check(
        'one-reminder-per-overdue',
        'Exactly one reminder for each overdue invoice, and none for the others',
        JSON.stringify(drafted) === JSON.stringify(expected),
        `expected ${expected.join(', ')}; drafted ${drafted.join(', ')}`,
      ),
      check(
        'one-approval-per-post',
        'Every POST raised exactly one approval',
        sends.length > 0 && approvals.length === sends.length,
        `${approvals.length} approval(s) for ${sends.length} POST(s); ${expected.length} overdue`,
      ),
      check(
        'every-invoice-covered',
        'Every overdue invoice is named in an approved send',
        expected.length > 0 && uncovered.length === 0,
        uncovered.length === 0 ? `all ${expected.length} covered` : `not covered: ${uncovered.join(', ')}`,
      ),
      check(
        'sends-allowed-once',
        'Every approval was allowed once and then ran',
        approvals.length > 0 && approvals.every((record) => record.action === 'allow_once'),
        approvals.map((record) => record.action).join(', ') || 'none',
      ),
      info(
        'batching',
        'POSTs that named several invoices (one approval each)',
        `${batched.length} of ${sends.length} POST(s) named several invoices${
          batched.length === 0 ? '' : `: ${batched.map((call) => `${expected.filter((id) => call.body.includes(id)).length} invoices in one`).join(', ')}`
        }`,
      ),
      review('reminder-tone', 'Are the reminders polite and accurate?', textsOf(evidence, 'tuca')),
    ];
  },
};
