import { describe, expect, it } from 'vitest';
import { ArgError, DEFAULT_BASE, DEFAULT_MODEL, parseArgs } from './args';

const now = new Date('2026-10-19T12:00:00.000Z');

describe('parseArgs', () => {
  it('uses defaults when no options are given', () => {
    const options = parseArgs([], now);
    expect(options.base).toBe(DEFAULT_BASE);
    expect(options.model).toBe(DEFAULT_MODEL);
    expect(options.engine).toBe('dsh');
    expect(options.cases).toBeUndefined();
    expect(options.maxUsd).toBe(5);
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
