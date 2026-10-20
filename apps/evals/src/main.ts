import { join } from 'node:path';
import { ArgError, outputNames, parseArgs, USAGE } from './args';
import { ALL_CASES, selectCases } from './cases';
import { runEval, skipReasonFor } from './runner';
import { errorMessage } from './util';

function listCases(): string {
  return ALL_CASES.map((caseDef) => {
    const reason = skipReasonFor(caseDef);
    const status = reason !== undefined ? `skip (${reason})` : caseDef.status;
    return `${caseDef.id.padEnd(4)} ${status.padEnd(12)} ${caseDef.title}`;
  }).join('\n');
}

async function main(): Promise<number> {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgError) {
      console.error(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.list) {
    console.log(listCases());
    return 0;
  }

  const cases = options.resume !== undefined ? selectCases([options.resume]) : selectCases(options.cases);
  const results = await runEval({ options, cases, log: (line) => console.log(`[evals] ${line}`) });

  const counts = new Map<string, number>();
  for (const outcome of results.cases) counts.set(outcome.status, (counts.get(outcome.status) ?? 0) + 1);
  const summary = [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(', ');
  const report = join(options.out, outputNames(options.suffix).report);
  console.log(`[evals] done: ${summary}. Cost $${results.totals.costUsd.toFixed(4)}. Report: ${report}`);
  const failed = results.cases.some((outcome) => outcome.status === 'fail' || outcome.status === 'error');
  return failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`[evals] ${errorMessage(error)}`);
    process.exitCode = 1;
  },
);
