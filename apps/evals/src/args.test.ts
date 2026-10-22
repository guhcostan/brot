import { describe, expect, it } from 'vitest';
import { ArgError, DEFAULT_BASE, DEFAULT_MODEL, outputNames, parseArgs } from './args';

const now = new Date('2026-10-19T12:00:00.000Z');

describe('parseArgs', () => {
  it('uses defaults when no options are given', () => {
    const options = parseArgs([], now);
    expect(options.base).toBe(DEFAULT_BASE);
    expect(options.model).toBe(DEFAULT_MODEL);
    expect(options.engine).toBe('dsh');
    expect(options.cases).toBeUndefined();
    expect(options.maxUsd).toBe(5);
    expect(options.maxCaseUsd).toBe(1.5);
    expect(options.suffix).toBeUndefined();
    expect(options.caseTimeoutMs).toBe(10 * 60_000);
    expect(options.keepComputers).toBe(false);
    expect(options.out).toMatch(/results\/2026-10-19T12-00-00-000Z$/);
  });

  it('reads every option and drops the separator and trailing slashes', () => {
    const options = parseArgs([
      '--',
      '--base',
      'http://127.0.0.1:8821/',
      '--model',
      'opencode-go/deepseek-v4.1-flash',
      '--engine',
      'mock',
      '--cases',
      'a1, c10',
      '--out',
      '/tmp/evals-out',
      '--max-usd',
      '0.5',
      '--case-timeout-min',
      '2',
      '--poll-ms',
      '250',
      '--keep-computers',
    ]);
    expect(options.base).toBe('http://127.0.0.1:8821');
    expect(options.engine).toBe('mock');
    expect(options.cases).toEqual(['A1', 'C10']);
    expect(options.out).toBe('/tmp/evals-out');
    expect(options.maxUsd).toBe(0.5);
    expect(options.caseTimeoutMs).toBe(120_000);
    expect(options.pollMs).toBe(250);
    expect(options.keepComputers).toBe(true);
  });

  it('accepts a zero cost cap and rejects a negative one', () => {
    expect(parseArgs(['--max-usd', '0']).maxUsd).toBe(0);
    expect(() => parseArgs(['--max-usd', '-1'])).toThrow(ArgError);
  });

  it('treats --cases all as every case', () => {
    expect(parseArgs(['--cases', 'all']).cases).toBeUndefined();
  });

  it('reads the per-case cap and refuses a zero or negative one', () => {
    expect(parseArgs(['--max-case-usd', '0.25']).maxCaseUsd).toBe(0.25);
    expect(() => parseArgs(['--max-case-usd', '0'])).toThrow(/--max-case-usd must be a positive number/);
    expect(() => parseArgs(['--max-case-usd', '-2'])).toThrow(ArgError);
  });

  it('runs a subset of cases into the same out dir with a suffix', () => {
    const options = parseArgs(['--out', '/tmp/eval-run1', '--cases', 'a6, a8', '--suffix', 'run2'], now);
    expect(options.out).toBe('/tmp/eval-run1');
    expect(options.cases).toEqual(['A6', 'A8']);
    expect(options.suffix).toBe('run2');
    expect(outputNames(options.suffix)).toEqual({ results: 'results-run2.json', report: 'REPORT-run2.md', artifacts: 'artifacts-run2' });
    expect(outputNames(undefined)).toEqual({ results: 'results.json', report: 'REPORT.md', artifacts: 'artifacts' });
  });

  it('rejects a suffix that is not a plain name, an empty case list, and a suffix with resume', () => {
    expect(() => parseArgs(['--suffix', 'run 2'])).toThrow(/--suffix must be/);
    expect(() => parseArgs(['--suffix', '../x'])).toThrow(/--suffix must be/);
    expect(() => parseArgs(['--cases', ' , '])).toThrow(/needs at least one case id/);
    expect(() => parseArgs(['--resume', 'C6', '--suffix', 'x'])).toThrow(/either --suffix or --resume/);
  });

  it('rejects an unknown engine, an unknown flag and a flag without a value', () => {
    expect(() => parseArgs(['--engine', 'codex'])).toThrow(/--engine must be/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown option/);
    expect(() => parseArgs(['--base'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--base', '--engine', 'mock'])).toThrow(/needs a value/);
  });

  it('rejects a base URL that is not absolute', () => {
    expect(() => parseArgs(['--base', '127.0.0.1:8799'])).toThrow(ArgError);
  });

  it('resumes one case and refuses to combine resume with a case list', () => {
    expect(parseArgs(['--resume', 'c6']).resume).toBe('C6');
    expect(() => parseArgs(['--resume', 'C6', '--cases', 'A1'])).toThrow(/either --cases or --resume/);
  });
});
