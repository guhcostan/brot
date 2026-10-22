import { resolve } from 'node:path';

export type EngineChoice = 'dsh' | 'mock';

export interface RunOptions {
  base: string;
  model: string;
  engine: EngineChoice;
  /** Case ids to run, in the order given. `undefined` means every case. */
  cases?: string[];
  out: string;
  /** Appended to the output names (`results-<suffix>.json`, `REPORT-<suffix>.md`, `artifacts-<suffix>/`), so a subset re-run keeps the earlier files. */
  suffix?: string;
  /** Total spend across the run. Checked between cases and during each case. */
  maxUsd: number;
  /** Spend allowed for one case. A case over it is stopped with reason `budget`. */
  maxCaseUsd: number;
  caseTimeoutMs: number;
  pollMs: number;
  /** Phase 2 of a two-phase case: the case id to resume. */
  resume?: string;
  keepComputers: boolean;
  list: boolean;
  help: boolean;
}

export const DEFAULT_BASE = 'http://127.0.0.1:8799';
export const DEFAULT_MODEL = 'opencode-go/deepseek-v4.1-flash';
export const DEFAULT_MAX_USD = 5;
export const DEFAULT_MAX_CASE_USD = 1.5;
export const DEFAULT_CASE_TIMEOUT_MIN = 10;
export const DEFAULT_POLL_MS = 1500;

export class ArgError extends Error {}

const SUFFIX = /^[A-Za-z0-9_-]{1,40}$/;

/** File and folder names for a run. A suffix keeps a subset re-run from overwriting the files of an earlier run. */
export function outputNames(suffix: string | undefined): { results: string; report: string; artifacts: string } {
  const tail = suffix === undefined ? '' : `-${suffix}`;
  return { results: `results${tail}.json`, report: `REPORT${tail}.md`, artifacts: `artifacts${tail}` };
}

const FLAGS_WITH_VALUE = new Set([
  '--base',
  '--model',
  '--engine',
  '--cases',
  '--out',
  '--max-usd',
  '--max-case-usd',
  '--suffix',
  '--case-timeout-min',
  '--poll-ms',
  '--resume',
]);

function positiveNumber(flag: string, value: string, { allowZero = false } = {}): number {
  const parsed = Number(value);
  const ok = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!ok) throw new ArgError(`${flag} must be a ${allowZero ? 'non-negative' : 'positive'} number, got "${value}"`);
  return parsed;
}

/** Parses the runner's command line. Throws `ArgError` with a message a person can act on. */
export function parseArgs(argv: readonly string[], now: Date = new Date()): RunOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (token === '--') continue;
    if (!token.startsWith('--')) throw new ArgError(`unexpected argument "${token}"`);
    if (FLAGS_WITH_VALUE.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new ArgError(`${token} needs a value`);
      values.set(token, value);
      index += 1;
    } else if (token === '--keep-computers' || token === '--list' || token === '--help') {
      flags.add(token);
    } else {
      throw new ArgError(`unknown option ${token}`);
    }
  }

  const engine = values.get('--engine') ?? 'dsh';
  if (engine !== 'dsh' && engine !== 'mock') throw new ArgError(`--engine must be "dsh" or "mock", got "${engine}"`);

  const casesValue = values.get('--cases');
  const cases =
    casesValue === undefined || casesValue === 'all'
      ? undefined
      : casesValue
          .split(',')
          .map((id) => id.trim().toUpperCase())
          .filter((id) => id !== '');
  if (cases !== undefined && cases.length === 0) throw new ArgError('--cases needs at least one case id, e.g. A1,A8');

  const suffixValue = values.get('--suffix');
  if (suffixValue !== undefined && !SUFFIX.test(suffixValue)) {
    throw new ArgError(`--suffix must be 1-40 letters, digits, "-" or "_", got "${suffixValue}"`);
  }

  const resume = values.get('--resume')?.trim().toUpperCase();
  if (resume !== undefined && cases !== undefined) throw new ArgError('use either --cases or --resume, not both');
  if (resume !== undefined && suffixValue !== undefined) {
    throw new ArgError('use either --suffix or --resume: phase 2 merges into the phase 1 results.json');
  }

  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const base = values.get('--base') ?? DEFAULT_BASE;
  try {
    void new URL(base);
  } catch {
    throw new ArgError(`--base must be an absolute URL, got "${base}"`);
  }

  return {
    base: base.replace(/\/+$/, ''),
    model: values.get('--model') ?? DEFAULT_MODEL,
    engine,
    ...(cases === undefined ? {} : { cases }),
    out: resolve(values.get('--out') ?? `results/${stamp}`),
    ...(suffixValue === undefined ? {} : { suffix: suffixValue }),
    maxUsd: positiveNumber('--max-usd', values.get('--max-usd') ?? String(DEFAULT_MAX_USD), { allowZero: true }),
    maxCaseUsd: positiveNumber('--max-case-usd', values.get('--max-case-usd') ?? String(DEFAULT_MAX_CASE_USD)),
    caseTimeoutMs:
      positiveNumber('--case-timeout-min', values.get('--case-timeout-min') ?? String(DEFAULT_CASE_TIMEOUT_MIN)) * 60_000,
    pollMs: positiveNumber('--poll-ms', values.get('--poll-ms') ?? String(DEFAULT_POLL_MS)),
    ...(resume === undefined ? {} : { resume }),
    keepComputers: flags.has('--keep-computers'),
    list: flags.has('--list'),
    help: flags.has('--help'),
  };
}

export const USAGE = `Usage: pnpm --filter @brot/evals start -- [options]

Runs the use cases in docs/USE-CASES.md against a running Brot server over HTTP.

Options:
  --base <url>               Server base URL (default ${DEFAULT_BASE})
  --model <provider/model>   Model for dsh bots (default ${DEFAULT_MODEL})
  --engine <dsh|mock>        Engine for every bot (default dsh). mock runs no model and costs nothing.
  --cases <ids>              Comma-separated case ids, e.g. A1,A3,C10. Default: all
  --out <dir>                Output directory for results.json, REPORT.md and artifacts
  --suffix <name>            Add the name to the output files (results-<name>.json, REPORT-<name>.md,
                             artifacts-<name>/), so a subset re-run with --cases keeps the earlier run's files
  --max-usd <n>              Total spend for the run. No new case starts, and a running case stops, once it is exceeded (default ${DEFAULT_MAX_USD})
  --max-case-usd <n>         Spend allowed for one case. A case over it is cancelled and marked stopped: budget (default ${DEFAULT_MAX_CASE_USD})
  --case-timeout-min <n>     Time limit per case in minutes (default ${DEFAULT_CASE_TIMEOUT_MIN})
  --poll-ms <n>              Poll interval for runs, events and approvals (default ${DEFAULT_POLL_MS})
  --resume <id>              Run phase 2 of a two-phase case (C6). Use the same --base and --out as phase 1.
  --keep-computers           Do not remove the containers, networks and volumes this run created
  --list                     Print the cases and their status, then exit
  --help                     Print this help
`;
