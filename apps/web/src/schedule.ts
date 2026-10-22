import type { RoutineTrigger } from '@brot/protocol';
import { getLocale, t, type TranslationKey } from './i18n';

/**
 * The routine schedule builder's presets and the cron patterns behind them. The server owns cron
 * validation; these helpers only translate between the builder's fields, the stored cron string and
 * the human description the Routines page shows (DESIGN.md sections 5 and 8).
 */

export type SchedulePreset = 'every15' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom';

/** The builder's fields: 24h clock, and 0 = Sunday for the weekly day. */
export interface ScheduleParts {
  hour: number;
  minute: number;
  weekday?: number;
}

export interface MatchedSchedule {
  preset: SchedulePreset;
  parts: ScheduleParts;
}

const DEFAULT_PARTS: ScheduleParts = { hour: 9, minute: 0 };

const pad = (value: number): string => String(value).padStart(2, '0');

export function formatClock(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

export function parseClock(value: string): { hour: number; minute: number } | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return undefined;
  return { hour, minute };
}

/** The cron pattern a preset writes. `custom` keeps whatever the person typed. */
export function presetCron(preset: Exclude<SchedulePreset, 'custom'>, parts: ScheduleParts = DEFAULT_PARTS): string {
  switch (preset) {
    case 'every15':
      return '*/15 * * * *';
    case 'hourly':
      return '0 * * * *';
    case 'daily':
      return `${parts.minute} ${parts.hour} * * *`;
    case 'weekdays':
      return `${parts.minute} ${parts.hour} * * 1-5`;
    case 'weekly':
      return `${parts.minute} ${parts.hour} * * ${parts.weekday ?? 1}`;
  }
}

/**
 * Reads a stored cron pattern back into a preset and its fields, so editing a routine opens on the
 * right preset. Patterns outside the supported presets open as `custom`.
 */
export function matchSchedule(cron: string): MatchedSchedule {
  const custom = (): MatchedSchedule => ({ preset: 'custom', parts: DEFAULT_PARTS });
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return custom();
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  if (minuteField === undefined || hourField === undefined || dayField === undefined || monthField === undefined || weekdayField === undefined) {
    return custom();
  }
  if (dayField !== '*' || monthField !== '*') return custom();
  if (minuteField === '*/15' && hourField === '*' && weekdayField === '*') return { preset: 'every15', parts: { hour: 0, minute: 0 } };
  if (minuteField === '0' && hourField === '*' && weekdayField === '*') return { preset: 'hourly', parts: { hour: 0, minute: 0 } };
  if (!/^\d{1,2}$/.test(minuteField) || !/^\d{1,2}$/.test(hourField)) return custom();
  const minute = Number(minuteField);
  const hour = Number(hourField);
  if (minute > 59 || hour > 23) return custom();
  if (weekdayField === '*') return { preset: 'daily', parts: { hour, minute } };
  if (weekdayField === '1-5') return { preset: 'weekdays', parts: { hour, minute } };
  if (/^[0-6]$/.test(weekdayField)) return { preset: 'weekly', parts: { hour, minute, weekday: Number(weekdayField) } };
  return custom();
}

/** A localized weekday name for a cron day-of-week (0 = Sunday). */
export function weekdayName(weekday: number): string {
  // 2026-10-18 is a Sunday in UTC; add the day offset to get the requested weekday.
  const date = new Date(Date.UTC(2026, 9, 18 + weekday));
  return new Intl.DateTimeFormat(getLocale(), { weekday: 'long', timeZone: 'UTC' }).format(date);
}

/** The one-line, localized schedule a routine row shows. Webhook routines say so. */
export function describeSchedule(trigger: RoutineTrigger): string {
  if (trigger.type === 'webhook') return t('routines.schedule.webhook');
  const matched = matchSchedule(trigger.cron);
  const time = formatClock(matched.parts.hour, matched.parts.minute);
  let text: string;
  switch (matched.preset) {
    case 'every15':
      text = t('routines.schedule.everyMinutes', { count: '15' });
      break;
    case 'hourly':
      text = t('routines.schedule.hourly');
      break;
    case 'daily':
      text = t('routines.schedule.daily', { time });
      break;
    case 'weekdays':
      text = t('routines.schedule.weekdays', { time });
      break;
    case 'weekly':
      text = t('routines.schedule.weekly', { day: weekdayName(matched.parts.weekday ?? 1), time });
      break;
    case 'custom':
      text = t('routines.schedule.custom', { cron: trigger.cron });
      break;
  }
  return trigger.timezone === undefined ? text : `${text} · ${trigger.timezone}`;
}

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Asia/Tokyo',
];

/** The browser's timezone, the default for a new routine. */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every IANA timezone the runtime knows, with UTC and the routine's own zone included. */
export function timezoneOptions(current?: string): string[] {
  let zones: string[] = FALLBACK_TIMEZONES;
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    // An older engine without supportedValuesOf: the short list still covers the common cases.
  }
  const options = [...zones];
  // supportedValuesOf omits UTC, which is still a valid croner timezone.
  if (!options.includes('UTC')) options.unshift('UTC');
  if (current !== undefined && current !== '' && !options.includes(current)) options.unshift(current);
  return options;
}

export interface RelativeTime {
  key: Extract<TranslationKey, `routines.relative.${string}`>;
  /** Minutes, hours, or days depending on the key. */
  count: number;
}

/** How soon a routine's next run is, as a translation key plus its count. Absent without a next run. */
export function relativeNextRun(iso: string | undefined, now = Date.now()): RelativeTime | undefined {
  if (iso === undefined) return undefined;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return undefined;
  const minutes = Math.round((at - now) / 60_000);
  if (minutes < 0) return { key: 'routines.relative.overdue', count: 0 };
  if (minutes < 1) return { key: 'routines.relative.underMinute', count: 0 };
  if (minutes < 60) return { key: 'routines.relative.minutes', count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { key: 'routines.relative.hours', count: hours };
  return { key: 'routines.relative.days', count: Math.round(hours / 24) };
}

/** How long a run took, localized; absent while it is still running. */
export function formatRunDuration(startedAt: string, endedAt?: string): string | undefined {
  if (endedAt === undefined) return undefined;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return t('routines.duration.seconds', { seconds: String(seconds) });
  return t('routines.duration.minutes', { minutes: String(Math.floor(seconds / 60)), seconds: String(seconds % 60) });
}
