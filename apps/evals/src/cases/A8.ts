import { check, review } from '../checks';
import type { Case } from '../types';
import { botSpec, fixturePath, httpCalls, readFixtureJson, textsOf } from './shared';

const EGRESS = ['httpbin.org'];

export const A8: Case = {
  id: 'A8',
  title: 'Invoice reminders: one reminder per overdue invoice, each send needs approval',
  status: 'sim',
  note: 'Simulated: invoices are a fixture and sends go to httpbin.org as the fake API.',
  egress: EGRESS,
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
    return [
      check(
        'one-reminder-per-overdue',
        'Exactly one reminder for each overdue invoice, and none for the others',
        JSON.stringify(drafted) === JSON.stringify(expected),
        `expected ${expected.join(', ')}; drafted ${drafted.join(', ')}`,
      ),
      check(
        'each-send-approved',
        'Every send raised its own approval',
        approvals.length >= expected.length && approvals.length === sends.length,
        `${approvals.length} approval(s) for ${sends.length} POST(s); ${expected.length} overdue`,
      ),
      check(
        'sends-allowed-once',
        'Every approval was allowed once and then ran',
        approvals.length > 0 && approvals.every((record) => record.action === 'allow_once'),
        approvals.map((record) => record.action).join(', ') || 'none',
      ),
      review('reminder-tone', 'Are the reminders polite and accurate?', textsOf(evidence, 'tuca')),
    ];
  },
};
