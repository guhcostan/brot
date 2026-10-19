import type { LiveStatus } from './api/liveEvents';

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "14:02" today, "Mon 14:02" this week, "12 Mar" otherwise. Uses the device's local time. */
export function shortTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return clock;
  if (now.getTime() - date.getTime() < 6 * 86_400_000) {
    return `${WEEKDAYS[date.getDay()]} ${clock}`;
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Honest connection copy for the inbox header (DESIGN.md section 8). */
export function connectionLabel(status: LiveStatus, lastSeenAt: string | undefined, now: Date = new Date()): string {
  switch (status) {
    case 'live':
      return 'Connected';
    case 'idle':
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return lastSeenAt ? `Oven off · last seen ${shortTime(lastSeenAt, now)}` : 'Can’t reach your computer';
    case 'unauthorized':
      return 'This phone was unpaired';
  }
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
