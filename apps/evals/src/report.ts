import type { CaseOutcome, CheckStatus, ResultStatus } from './types';

export interface ResultsFile {
  schema: 1;
  generatedAt: string;
  base: string;
  engine: string;
  model: string;
  maxUsd: number;
  server?: { version: string; protocol: number };
  dockerServer?: string;
  totals: { costUsd: number; tokensIn: number; tokensOut: number; runs: number };
  cases: CaseOutcome[];
  /** `brot-*` containers, networks and volumes of this run's bots that still exist after cleanup. */
  leftovers: string[];
}

/** Keeps a table cell on one line and stops a pipe from ending the cell. */
export function cell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

const RESULT_LABEL: Record<ResultStatus, string> = {
  pass: 'pass',
  fail: 'fail',
  skipped: 'skipped',
  error: 'error',
  pending: 'pending (restart)',
};

export function resultLabel(outcome: Pick<CaseOutcome, 'status' | 'needsReview'>): string {
  const label = RESULT_LABEL[outcome.status];
  return outcome.needsReview && outcome.status === 'pass' ? `${label}, needs-review` : label;
}

export function countChecks(outcome: CaseOutcome): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { pass: 0, fail: 0, review: 0, info: 0 };
  for (const check of outcome.checks) counts[check.status] += 1;
  return counts;
}

function checksSummary(outcome: CaseOutcome): string {
  if (outcome.checks.length === 0) return '-';
  const counts = countChecks(outcome);
  return `${counts.pass} pass, ${counts.fail} fail, ${counts.review} review`;
}

function money(value: number): string {
  return `$${value.toFixed(4)}`;
}

function summaryRow(outcome: CaseOutcome): string {
  const note = outcome.skipReason ?? outcome.error ?? outcome.coveredBy ?? '';
  return [
    outcome.id,
    cell(outcome.title),
    outcome.caseStatus,
    resultLabel(outcome),
    checksSummary(outcome),
    money(outcome.costUsd),
    String(outcome.approvals.length),
    cell(note),
  ].join(' | ');
}

function checksTable(outcome: CaseOutcome): string[] {
  if (outcome.checks.length === 0) return ['_No checks ran._', ''];
  const lines = ['| Check | Status | Evidence |', '| --- | --- | --- |'];
  for (const check of outcome.checks) {
    lines.push(`| ${cell(check.label)} (${check.id}) | ${check.status} | ${cell(check.evidence)} |`);
  }
  return [...lines, ''];
}

function approvalsTable(outcome: CaseOutcome): string[] {
  if (outcome.approvals.length === 0) return ['_No approvals._', ''];
  const lines = [
    '| Bot | Tool | Kind | Summary | Decision | Time to appear | Policy reason |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const approval of outcome.approvals) {
    const decision = approval.action === 'hold' ? 'held' : approval.action;
    lines.push(
      `| ${cell(approval.botKey)} | ${cell(approval.tool)} | ${approval.kind} | ${cell(approval.summary)} | ${decision}${
        approval.error === undefined ? '' : ` (${cell(approval.error)})`
      } | ${approval.timeToAppearMs} ms | ${cell(approval.reason)} |`,
    );
  }
  return [...lines, ''];
}

function caseSection(outcome: CaseOutcome): string[] {
  const lines = [`### ${outcome.id}: ${outcome.title}`, ''];
  lines.push(`- Status: **${resultLabel(outcome)}** (case status: ${outcome.caseStatus})`);
  if (outcome.skipReason !== undefined) lines.push(`- Skipped: ${outcome.skipReason}`);
  if (outcome.coveredBy !== undefined) lines.push(`- Covered by tests: \`${outcome.coveredBy}\``);
  if (outcome.error !== undefined) lines.push(`- Error: ${outcome.error}`);
  if (outcome.instructions !== undefined) lines.push(`- Next step: ${outcome.instructions}`);
  lines.push(
    `- Runs: ${outcome.runCount}, tokens in/out: ${outcome.tokensIn}/${outcome.tokensOut}, cost: ${money(outcome.costUsd)}`,
  );
  if (outcome.durationMs !== undefined) lines.push(`- Duration: ${Math.round(outcome.durationMs / 1000)} s`);
  lines.push('');
  if (outcome.checks.length > 0) {
    lines.push('#### Checks', '', ...checksTable(outcome));
  }
  lines.push('#### Approvals', '', ...approvalsTable(outcome));
  if (outcome.notableEvents.length > 0) {
    lines.push('#### Notable events', '', ...outcome.notableEvents.map((event) => `- ${cell(event)}`), '');
  }
  if (outcome.finalTexts.length > 0) {
    lines.push('#### Final texts (for human review)', '');
    for (const entry of outcome.finalTexts) {
      lines.push(`**${entry.bot}**`, '', ...entry.text.split('\n').map((line) => `> ${line}`), '');
    }
  }
  return lines;
}

/** Renders the markdown report from the results file. Pure, so it can be tested without a server. */
export function renderReport(results: ResultsFile): string {
  const lines: string[] = [
    '# Brot use-case eval report',
    '',
    `Generated ${results.generatedAt} against ${results.base}. Engine: ${results.engine}${
      results.engine === 'dsh' ? `, model ${results.model}` : ''
    }. Cost cap ${money(results.maxUsd)}.`,
    '',
    `Total: ${results.totals.runs} runs, ${results.totals.tokensIn} tokens in, ${results.totals.tokensOut} tokens out, ${money(
      results.totals.costUsd,
    )}.${results.server === undefined ? '' : ` Server ${results.server.version} (protocol ${results.server.protocol}).`}${
      results.dockerServer === undefined ? '' : ` Docker server ${results.dockerServer}.`
    }`,
    '',
    'Pass and fail come from objective checks. `review` checks store the output for a person to read, and the case is marked needs-review. Cases marked later, gap or covered are not run.',
    '',
    '## Summary',
    '',
    '| Case | Title | Case status | Result | Checks | Cost | Approvals | Note |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.cases.map((outcome) => `| ${summaryRow(outcome)} |`),
    '',
    '## Cases',
    '',
  ];
  for (const outcome of results.cases) lines.push(...caseSection(outcome));
  lines.push('## Leftover resources', '');
  lines.push(
    results.leftovers.length === 0
      ? 'None. Every container, network and volume of this run was removed.'
      : results.leftovers.map((name) => `- \`${name}\``).join('\n'),
    '',
  );
  return `${lines.join('\n')}\n`;
}
