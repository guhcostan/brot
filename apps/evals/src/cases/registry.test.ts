import { describe, expect, it } from 'vitest';
import { ALL_CASES, selectCases } from './index';
import { skipReasonFor } from '../runner';

describe('case registry', () => {
  it('lists every use case once, in the document order', () => {
    const ids = ALL_CASES.map((caseDef) => caseDef.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 3)).toEqual(['A1', 'A2', 'A3']);
    expect(ids).toHaveLength(15 + 8 + 10);
    expect(ids.at(-1)).toBe('C10');
  });

  it('skips the later and gap cases with a reason, and only those', () => {
    const skipped = ALL_CASES.filter((caseDef) => skipReasonFor(caseDef) !== undefined).map((caseDef) => caseDef.id);
    expect(skipped).toEqual(['A11']);
    for (const id of skipped) expect(skipReasonFor(ALL_CASES.find((caseDef) => caseDef.id === id)!)).toMatch(/\w/);
  });

  it('records C8 as covered by tests, with the test file it points to', () => {
    const c8 = ALL_CASES.find((caseDef) => caseDef.id === 'C8');
    expect(c8?.status).toBe('covered');
    expect(c8?.coveredBy).toContain('apps/server/src/llm/relay.test.ts');
  });

  it('runs the two-phase case C6 with a phase 2', () => {
    const c6 = ALL_CASES.find((caseDef) => caseDef.id === 'C6');
    expect(c6?.resume).toBe(true);
    expect(c6?.resumeRun).toBeTypeOf('function');
  });

  it('uses only the statuses in USE-CASES.md', () => {
    for (const caseDef of ALL_CASES) expect(['now', 'sim', 'later', 'gap', 'covered']).toContain(caseDef.status);
  });

  it('lets the sim cases send to the fake API once, and keeps the others on the default policy', () => {
    const decideFor = (id: string, summary: string) => {
      const caseDef = ALL_CASES.find((candidate) => candidate.id === id);
      const policy = caseDef?.approvals;
      return policy?.decide({ botId: 'b', runId: 'r', tool: 'http_request', kind: 'send', summary, args: {} }).action;
    };
    for (const id of ['A6', 'A8', 'A14']) {
      expect(decideFor(id, 'POST https://httpbin.org/anything/x/send'), id).toBe('allow_once');
      expect(decideFor(id, 'POST https://api.github.com/repos/x/y/pulls'), id).toBe('deny');
    }
    expect(ALL_CASES.find((candidate) => candidate.id === 'B5')?.approvals).toBeUndefined();
  });

  it('selects cases in the order given and rejects unknown ids', () => {
    expect(selectCases(['c10', 'A1']).map((caseDef) => caseDef.id)).toEqual(['C10', 'A1']);
    expect(() => selectCases(['A99'])).toThrow(/unknown case id/);
    expect(selectCases(undefined)).toHaveLength(ALL_CASES.length);
  });
});
