import type {
  Run,
  UsageGrouping,
  UsageGroup,
  UsageRange,
  UsageSummary,
  UsageTotals,
} from '@brot/protocol';

/** Days of history the usage endpoints cover when the query names no range. */
export const DEFAULT_USAGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A usage query after defaults are applied. `from` is inclusive and `to` exclusive; both are ISO in UTC. */
export interface ResolvedUsageRange {
  from: string;
  to: string;
  botId?: string;
  group: UsageGrouping;
}

export type UsageRangeResolution =
  | { ok: true; range: ResolvedUsageRange }
  | { ok: false; path: string[]; message: string };

/**
 * Resolves a usage query: `to` defaults to `now` and `from` to 30 days before the resolved `to`. An explicit
 * bound is normalized to `toISOString()`, which is the form stored on runs and therefore compares exactly.
 */
export function resolveUsageRange(query: UsageRange, now: Date): UsageRangeResolution {
  const to = query.to === undefined ? now.toISOString() : new Date(query.to).toISOString();
  const from =
    query.from === undefined
      ? new Date(Date.parse(to) - DEFAULT_USAGE_DAYS * DAY_MS).toISOString()
      : new Date(query.from).toISOString();
  if (Date.parse(from) > Date.parse(to)) {
    return { ok: false, path: ['from'], message: 'from must not be after to' };
  }
  return {
    ok: true,
    range: { from, to, ...(query.botId === undefined ? {} : { botId: query.botId }), group: query.group },
  };
}

/** The zero of every total, so a caller never shares a mutable object with another bucket. */
export function emptyUsageTotals(): UsageTotals {
  return { runs: 0, completed: 0, failed: 0, cancelled: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

function addRun(totals: UsageTotals, run: Run): void {
  totals.runs += 1;
  if (run.status === 'completed') totals.completed += 1;
  else if (run.status === 'failed') totals.failed += 1;
  else if (run.status === 'cancelled') totals.cancelled += 1;
  totals.tokensIn += run.tokensIn;
  totals.tokensOut += run.tokensOut;
  totals.costUsd += run.costUsd;
}

/** The UTC day (`YYYY-MM-DD`) a run started in. Day keys do not depend on the server's local timezone. */
export function usageDayKey(startedAt: string): string {
  return new Date(startedAt).toISOString().slice(0, 10);
}

/**
 * Totals and buckets for a list of runs. Status counts are terminal-status counts; tokens and cost cover every
 * run, including running and waiting-for-approval ones. Buckets are sorted by key.
 */
export function aggregateUsage(
  runs: readonly Run[],
  grouping: UsageGrouping,
  botNames: ReadonlyMap<string, string>,
): Pick<UsageSummary, 'totals' | 'groups'> {
  const totals = emptyUsageTotals();
  const buckets = new Map<string, UsageTotals>();
  for (const run of runs) {
    addRun(totals, run);
    const key = grouping === 'day' ? usageDayKey(run.startedAt) : run.botId;
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = emptyUsageTotals();
      buckets.set(key, bucket);
    }
    addRun(bucket, run);
  }
  const groups: UsageGroup[] = [...buckets.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, bucketTotals]) =>
      grouping === 'bot'
        ? { key, label: botNames.get(key) ?? key, totals: bucketTotals }
        : { key, totals: bucketTotals },
    );
  return { totals, groups };
}

/** The summary a route returns: the resolved range plus the aggregate. */
export function summarizeUsage(
  runs: readonly Run[],
  range: ResolvedUsageRange,
  botNames: ReadonlyMap<string, string>,
): UsageSummary {
  return { from: range.from, to: range.to, ...aggregateUsage(runs, range.group, botNames) };
}
