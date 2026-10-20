import type { LiveStatus } from './api/liveEvents';
import { t } from './i18n';

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:02" today, "Mon 14:02" this week, "12 Mar" otherwise. Uses the device's local time. */
export function shortTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return clock;
  if (now.getTime() - date.getTime() < 6 * 86_400_000) {
    return `${t('date.weekdays').split(',')[date.getDay()] ?? ''} ${clock}`;
  }
  return t('date.dayMonth', { day: date.getDate(), month: t('date.months').split(',')[date.getMonth()] ?? '' });
}

/** Honest connection copy for the inbox header (DESIGN.md section 8). */
export function connectionLabel(status: LiveStatus, lastSeenAt: string | undefined, now: Date = new Date()): string {
  switch (status) {
    case 'live':
      return t('connection.live');
    case 'idle':
    case 'connecting':
      return t('connection.connecting');
    case 'reconnecting':
      return lastSeenAt ? t('connection.lastSeen', { time: shortTime(lastSeenAt, now) }) : t('connection.unreachable');
    case 'unauthorized':
      return t('connection.unpaired');
  }
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
