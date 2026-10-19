import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { check, parseArtifact, review } from '../checks';
import type { Case } from '../types';
import { botSpec, FIXTURES, fixturePath, readFixture, readFixtureJson, textsOf } from './shared';

const EGRESS: string[] = [];
const RECEIPT_FILES = readdirSync(join(FIXTURES, 'receipts')).filter((name) => name.endsWith('.txt')).sort();

interface Reconciliation {
  receipts: Array<{ file: string; amount: number; ledgerId: string | null; status: string; policyClause: string | null }>;
  ledgerWithoutReceipt: Array<{ ledgerId: string; policyClause: string | null }>;
  totals: { receiptsTotal: number; matchedTotal: number };
}

/** The receipt amount as written in the receipt file: the Total line. Computed from the fixtures, never typed in. */
function truthAmounts(): Map<string, number> {
  return new Map(
    RECEIPT_FILES.map((file) => {
      const total = /Total: ([\d.]+) USD/.exec(readFixture(`receipts/${file}`))?.[1] ?? '0';
      return [file, Number(total)];
    }),
  );
}

const CLAUSES = new Set(['P-1', 'P-2', 'P-3', 'P-4']);
const round = (value: number): number => Math.round(value * 100) / 100;

export const A9: Case = {
  id: 'A9',
  title: 'Expense reconciliation: receipts to ledger, policy exceptions cited, totals reconcile',
  status: 'now',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'jabuti',
      botSpec(
        'jabuti',
        'Expense reconciliation',
        'You reconcile receipts with the ledger and flag policy exceptions. Every exception cites the policy clause it breaks. Totals always reconcile.',
        EGRESS,
      ),
    );
    await ctx.copyIn('jabuti', fixturePath('ledger.csv'), 'inputs/ledger.csv');
    await ctx.copyIn('jabuti', fixturePath('expense-policy.md'), 'inputs/expense-policy.md');
    for (const file of RECEIPT_FILES) await ctx.copyIn('jabuti', fixturePath(`receipts/${file}`), `inputs/receipts/${file}`);
    ctx.requestArtifact('jabuti', 'out/reconciliation.json');
    ctx.notes.expected = readFixtureJson<{ receiptTotal: number; expectedExceptions: Record<string, string> }>('ledger.key.json');
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'jabuti:dm',
      [
        'Expense reconciliation for the September trip. Inputs: /workspace/inputs/ledger.csv, /workspace/inputs/expense-policy.md, and six receipts in /workspace/inputs/receipts/.',
        'Match each receipt to a ledger line by vendor, date (within one day) and amount. Flag exceptions against the policy and quote the clause id (P-1 to P-4).',
        'Write /workspace/out/reconciliation.json with this shape:',
        '{"receipts":[{"file":"R-01.txt","amount":number,"ledgerId":string|null,"status":"matched"|"unmatched"|"exception","policyClause":string|null}],"ledgerWithoutReceipt":[{"ledgerId":string,"policyClause":string|null}],"totals":{"receiptsTotal":number,"matchedTotal":number}}',
        'matchedTotal is the sum of the matched receipts. receiptsTotal is the sum of all receipts. Both must reconcile with the receipt files.',
        'Reply with a short summary.',
      ].join('\n'),
    );
  },
  check(evidence) {
    const parsed = parseArtifact<Reconciliation>(evidence, 'jabuti:out/reconciliation.json');
    const truth = truthAmounts();
    const expectedTotal = round([...truth.values()].reduce((sum, value) => sum + value, 0));
    const expected = (evidence.notes.expected as { expectedExceptions: Record<string, string> } | undefined)?.expectedExceptions ?? {};
    if (parsed === undefined) {
      return [check('reconciliation-json', 'reconciliation.json exists and parses', false, 'missing or not JSON')];
    }
    const receipts = parsed.receipts ?? [];
    const files = receipts.map((item) => item.file).sort();
    const sumReceipts = round(receipts.reduce((sum, item) => sum + Number(item.amount), 0));
    const sumMatched = round(receipts.filter((item) => item.status === 'matched').reduce((sum, item) => sum + Number(item.amount), 0));
    const amountsMatch = receipts.length > 0 && receipts.every((item) => Math.abs(Number(item.amount) - (truth.get(item.file) ?? NaN)) < 0.005);
    const clausesValid = [...receipts.map((item) => item.policyClause), ...(parsed.ledgerWithoutReceipt ?? []).map((item) => item.policyClause)]
      .filter((clause): clause is string => clause !== null && clause !== undefined)
      .every((clause) => CLAUSES.has(clause));
    const exceptionOf = (file: string): string | null => receipts.find((item) => item.file === file)?.policyClause ?? null;
    const exceptionsRight = Object.entries(expected)
      .filter(([id]) => id.startsWith('R-'))
      .every(([file, clause]) => exceptionOf(`${file}.txt`) === clause || exceptionOf(file) === clause);
    const ledgerFlag = (parsed.ledgerWithoutReceipt ?? []).some((item) => item.ledgerId === 'L-107' && item.policyClause === 'P-1');
    const r06 = receipts.find((item) => item.file === 'R-06.txt');
    return [
      check('six-receipts-once', 'Each of the six receipts appears exactly once', files.length === 6 && new Set(files).size === 6, files.join(', ')),
      check('amounts-match-files', 'Every amount matches its receipt file', amountsMatch, receipts.map((item) => `${item.file}=${item.amount}`).join(', ')),
      check(
        'receipts-total-reconciles',
        `receiptsTotal and the sum of receipts both equal ${expectedTotal.toFixed(2)}`,
        round(Number(parsed.totals?.receiptsTotal)) === expectedTotal && sumReceipts === expectedTotal,
        `reported ${parsed.totals?.receiptsTotal}; summed ${sumReceipts}`,
      ),
      check(
        'matched-total-reconciles',
        'matchedTotal equals the sum of the matched receipts',
        round(Number(parsed.totals?.matchedTotal)) === sumMatched,
        `reported ${parsed.totals?.matchedTotal}; summed ${sumMatched}`,
      ),
      check('expected-exceptions', 'R-03 (P-2) and R-05 (P-3) are flagged with their clauses', exceptionsRight, JSON.stringify(receipts.filter((item) => item.status === 'exception'))),
      check('ledger-gap-flagged', 'The ledger line with no receipt (L-107, above 25 USD) is flagged under P-1', ledgerFlag, JSON.stringify(parsed.ledgerWithoutReceipt ?? [])),
      check('unmatched-receipt', 'R-06 (taxi, no ledger line) is unmatched', r06?.status === 'unmatched', r06?.status ?? 'missing'),
      check('clauses-are-real', 'Every cited clause exists in the policy (P-1 to P-4)', clausesValid, 'checked'),
      review('summary', 'Does the summary explain the exceptions correctly?', textsOf(evidence, 'jabuti')),
    ];
  },
};
