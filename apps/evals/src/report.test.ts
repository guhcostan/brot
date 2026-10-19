import { describe, expect, it } from 'vitest';
import { cell, countChecks, renderReport, resultLabel, type ResultsFile } from './report';
import type { CaseOutcome } from './types';

const outcome = (overrides: Partial<CaseOutcome>): CaseOutcome => ({
  id: 'A1',
  title: 'Bug reproduction',
  caseStatus: 'now',
  status: 'pass',
  needsReview: false,
  checks: [{ id: 'c1', label: 'Test fails | before fix', status: 'pass', evidence: 'exit 1' }],
  runCount: 2,
  costUsd: 0.0123,
  tokensIn: 100,
  tokensOut: 20,
  approvals: [],
  notableEvents: [],
  finalTexts: [],
  ...overrides,
});

const results = (cases: CaseOutcome[]): ResultsFile => ({
  schema: 1,
  generatedAt: '2026-10-19T12:00:00.000Z',
  base: 'http://127.0.0.1:8821',
  engine: 'dsh',
  model: 'opencode-go/deepseek-v4.1-flash',
  maxUsd: 5,
  totals: { costUsd: 0.0123, tokensIn: 100, tokensOut: 20, runs: 2 },
  cases,
  leftovers: [],
});

describe('report', () => {
  it('labels results, including needs-review on a pass', () => {
    expect(resultLabel({ status: 'pass', needsReview: true })).toBe('pass, needs-review');
    expect(resultLabel({ status: 'fail', needsReview: true })).toBe('fail');
    expect(resultLabel({ status: 'pending', needsReview: false })).toBe('pending (restart)');
  });

  it('counts checks by status', () => {
    const counts = countChecks(
      outcome({
        checks: [
          { id: 'a', label: 'a', status: 'pass', evidence: '' },
          { id: 'b', label: 'b', status: 'fail', evidence: '' },
          { id: 'c', label: 'c', status: 'review', evidence: '' },
          { id: 'd', label: 'd', status: 'info', evidence: '' },
        ],
      }),
    );
    expect(counts).toEqual({ pass: 1, fail: 1, review: 1, info: 1 });
  });

  it('keeps table cells on one line and escapes pipes', () => {
    expect(cell('a | b\nc')).toBe('a \\| b c');
  });

  it('renders the summary, the checks, the skip reason and the leftovers', () => {
    const markdown = renderReport(
      results([
        outcome({}),
        outcome({ id: 'A11', title: 'AI search visibility', caseStatus: 'later', status: 'skipped', checks: [], skipReason: 'later: needs a second route' }),
        outcome({ id: 'C8', title: 'Model pinned', caseStatus: 'covered', status: 'skipped', checks: [], coveredBy: 'apps/server/src/llm/relay.test.ts' }),
      ]),
    );
    expect(markdown).toContain('# Brot use-case eval report');
    expect(markdown).toContain('| A1 | Bug reproduction | now | pass | 1 pass, 0 fail, 0 review |');
    expect(markdown).toContain('later: needs a second route');
    expect(markdown).toContain('Covered by tests: `apps/server/src/llm/relay.test.ts`');
    expect(markdown).toContain('Test fails \\| before fix');
    expect(markdown).toContain('None. Every container, network and volume of this run was removed.');
  });

  it('lists leftovers when cleanup left something behind', () => {
    const markdown = renderReport({ ...results([outcome({})]), leftovers: ['brot-computer-abc'] });
    expect(markdown).toContain('- `brot-computer-abc`');
  });
});
