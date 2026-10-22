import type { Run, RoutineRun, TodayBot, TodayQuery, TodayRoutines, TodayTotals } from '@brot/protocol';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Highlights a Today page shows at most. */
export const TODAY_HIGHLIGHT_LIMIT = 5;

/** A highlight keeps at most this much of the assistant message. */
export const TODAY_HIGHLIGHT_TEXT_LENGTH = 200;

/** A Today query after defaults are applied. `from` is inclusive and `to` exclusive; both are ISO in UTC. */
export interface ResolvedTodayRange {
  from: string;
  to: string;
  tz: string;
}

export type TodayRangeResolution =
  | { ok: true; range: ResolvedTodayRange }
  | { ok: false; path: string[]; message: string };

/** The server's own IANA zone, used when the query names none. */
export function serverTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone === undefined || zone === '' ? 'UTC' : zone;
}

/** An IANA-style zone name; Intl also accepts bare offsets like `+05:30`, which are not zones. */
const TIME_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/** Whether the name is a valid IANA timezone. */
export function isValidTimeZone(timezone: string): boolean {
  if (!TIME_ZONE_NAME.test(timezone)) return false;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return formatter.resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}

/** The offset of `timezone` at `date`, in milliseconds east of UTC. */
function timeZoneOffsetMs(date: Date, timezone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === undefined || name === 'GMT') return 0;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (match === null) throw new Error(`timezone ${timezone} reported an unexpected offset ${name}`);
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0')) * 60_000;
}

/** The instant's wall clock in `timezone`, encoded as if that wall clock were UTC. */
function wallClockAsUtc(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const field = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(field('year'), field('month') - 1, field('day'), field('hour'), field('minute'), field('second'));
}

/**
 * The UTC instant of local midnight for the calendar day `date` falls on in `timezone`, computed with Intl only.
 * The offset is read twice, so a daylight-saving change around midnight still lands on the right instant.
 */
export function localMidnight(date: Date, timezone: string): Date {
  const dayStart = Math.floor(wallClockAsUtc(date, timezone) / DAY_MS) * DAY_MS;
  let instant = new Date(dayStart);
  for (let pass = 0; pass < 2; pass += 1) instant = new Date(dayStart - timeZoneOffsetMs(instant, timezone));
  return instant;
}

/**
 * Resolves a Today query: `to` defaults to `now` and `from` to local midnight of the resolved `to` in the
 * query's timezone, else the server's. Explicit bounds are normalized to ISO. The timezone is validated even
 * when both bounds are explicit.
 */
export function resolveTodayRange(
  query: TodayQuery,
  now: Date,
  defaultTimeZone: string,
): TodayRangeResolution {
  const tz = query.tz ?? defaultTimeZone;
  if (!isValidTimeZone(tz)) {
    return { ok: false, path: ['tz'], message: `${tz} is not an IANA timezone` };
  }
  const toDate = query.to === undefined ? now : new Date(query.to);
  const fromDate = query.from === undefined ? localMidnight(toDate, tz) : new Date(query.from);
  const from = fromDate.toISOString();
  const to = toDate.toISOString();
  if (Date.parse(from) > Date.parse(to)) {
    return { ok: false, path: ['from'], message: 'from must not be after to' };
  }
  return { ok: true, range: { from, to, tz } };
}

export function emptyTodayTotals(): TodayTotals {
  return { runs: 0, completed: 0, failed: 0, cancelled: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
}

function addRun(totals: TodayTotals, run: Run): void {
  totals.runs += 1;
  if (run.status === 'completed') totals.completed += 1;
  else if (run.status === 'failed') totals.failed += 1;
  else if (run.status === 'cancelled') totals.cancelled += 1;
  totals.tokensIn += run.tokensIn;
  totals.tokensOut += run.tokensOut;
  totals.costUsd += run.costUsd;
}

/**
 * Run totals and per-bot shares. Status counts are terminal-status counts; tokens and cost cover every run,
 * including running and waiting-for-approval ones. Per-bot shares are sorted by cost, then runs, then bot id.
 */
export function summarizeRuns(
  runs: readonly Run[],
  botNames: ReadonlyMap<string, string>,
): { totals: TodayTotals; byBot: TodayBot[] } {
  const totals = emptyTodayTotals();
  const buckets = new Map<string, TodayBot>();
  for (const run of runs) {
    addRun(totals, run);
    let bucket = buckets.get(run.botId);
    if (bucket === undefined) {
      bucket = {
        botId: run.botId,
        name: botNames.get(run.botId) ?? run.botId,
        runs: 0,
        completed: 0,
        failed: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      };
      buckets.set(run.botId, bucket);
    }
    bucket.runs += 1;
    if (run.status === 'completed') bucket.completed += 1;
    else if (run.status === 'failed') bucket.failed += 1;
    bucket.tokensIn += run.tokensIn;
    bucket.tokensOut += run.tokensOut;
    bucket.costUsd += run.costUsd;
  }
  const byBot = [...buckets.values()].sort(
    (left, right) =>
      right.costUsd - left.costUsd || right.runs - left.runs || (left.botId < right.botId ? -1 : left.botId > right.botId ? 1 : 0),
  );
  return { totals, byBot };
}

/** Routine run counts for the Today page. `running` merges queued and running runs; other statuses are ignored. */
export function countRoutineRuns(runs: readonly RoutineRun[]): TodayRoutines {
  const counts: TodayRoutines = { completed: 0, failed: 0, skipped: 0, running: 0 };
  for (const run of runs) {
    if (run.status === 'completed') counts.completed += 1;
    else if (run.status === 'failed') counts.failed += 1;
    else if (run.status === 'skipped') counts.skipped += 1;
    else if (run.status === 'queued' || run.status === 'running') counts.running += 1;
  }
  return counts;
}
