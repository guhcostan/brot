import { getLocale } from './i18n';
import { formatCount } from './format';
import { browserTimezone } from './schedule';

/** How far back the Insights page looks. `today` is local midnight to now; the others count days back from now. */
export type InsightsRange = 'today' | '7d' | '30d' | '90d' | 'custom';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The window sent to `GET /api/today`: local midnight when only the timezone is sent. */
export interface TodayWindow {
  from?: string;
  to?: string;
  tz?: string;
}

/** The window sent to `GET /api/usage` and the CSV export. */
export interface UsageWindow {
  from?: string;
  to?: string;
}

/** The UTC instant of the local midnight before `now`, so a "today" usage window starts where the day did. */
export function localMidnightIso(now: Date): string {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return midnight.toISOString();
}

/** The Today query for a range: today only names the timezone, so the server computes local midnight. */
export function todayWindow(range: InsightsRange, now = new Date(), custom?: UsageWindow): TodayWindow {
  if (range === 'today') return { tz: browserTimezone() };
  if (range === 'custom') return { ...(custom?.from === undefined ? {} : { from: custom.from }), ...(custom?.to === undefined ? {} : { to: custom.to }) };
  return { from: new Date(now.getTime() - daysOf(range) * DAY_MS).toISOString() };
}

/** The Usage query for a range. `to` is left out so the server ends the window at its own now. */
export function usageWindow(range: InsightsRange, now = new Date(), custom?: UsageWindow): UsageWindow {
  if (range === 'today') return { from: localMidnightIso(now) };
  if (range === 'custom') return { ...(custom?.from === undefined ? {} : { from: custom.from }), ...(custom?.to === undefined ? {} : { to: custom.to }) };
  return { from: new Date(now.getTime() - daysOf(range) * DAY_MS).toISOString() };
}

function daysOf(range: InsightsRange): number {
  if (range === '7d') return 7;
  if (range === '90d') return 90;
  return 30;
}

/**
 * A custom range from two `YYYY-MM-DD` inputs, covering both selected days in local time. Returns undefined
 * when either date is missing or the range runs backwards.
 */
export function customUsageWindow(from: string, to: string): UsageWindow | undefined {
  if (from === '' || to === '') return undefined;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() > end.getTime()) return undefined;
  return { from: start.toISOString(), to: new Date(end.getTime() + DAY_MS).toISOString() };
}

/** A usage day key (`YYYY-MM-DD`, UTC) as a short localized date. */
export function formatUsageDay(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/** A window bound as a short localized date. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric' }).format(date);
}

/** "184,320 / 52,880" — token sums with grouped digits. */
export function formatTokenPair(tokensIn: number, tokensOut: number): string {
  return `${formatCount(tokensIn)} / ${formatCount(tokensOut)}`;
}
