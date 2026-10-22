import { describe, expect, it } from 'vitest';
import {
  browserTimezone,
  describeSchedule,
  formatClock,
  formatRunDuration,
  matchSchedule,
  parseClock,
  presetCron,
  relativeNextRun,
  timezoneOptions,
  weekdayName,
} from './schedule';

describe('presetCron', () => {
  it('writes the cron of every preset', () => {
    expect(presetCron('every15')).toBe('*/15 * * * *');
    expect(presetCron('hourly')).toBe('0 * * * *');
    expect(presetCron('daily', { hour: 8, minute: 30 })).toBe('30 8 * * *');
    expect(presetCron('weekdays', { hour: 9, minute: 5 })).toBe('5 9 * * 1-5');
    expect(presetCron('weekly', { hour: 18, minute: 0, weekday: 3 })).toBe('0 18 * * 3');
  });
});

describe('matchSchedule', () => {
  it('reads each preset back, fields included', () => {
    expect(matchSchedule('*/15 * * * *')).toEqual({ preset: 'every15', parts: { hour: 0, minute: 0 } });
    expect(matchSchedule('0 * * * *')).toEqual({ preset: 'hourly', parts: { hour: 0, minute: 0 } });
    expect(matchSchedule('30 8 * * *')).toEqual({ preset: 'daily', parts: { hour: 8, minute: 30 } });
    expect(matchSchedule('5 9 * * 1-5')).toEqual({ preset: 'weekdays', parts: { hour: 9, minute: 5 } });
    expect(matchSchedule('0 18 * * 3')).toEqual({ preset: 'weekly', parts: { hour: 18, minute: 0, weekday: 3 } });
  });

  it('falls back to custom for anything outside the presets', () => {
    expect(matchSchedule('30 7 1 * *').preset).toBe('custom');
    expect(matchSchedule('0 9 * * MON').preset).toBe('custom');
    expect(matchSchedule('0 9 * * 7').preset).toBe('custom');
    expect(matchSchedule('0 9 * *').preset).toBe('custom');
    expect(matchSchedule('nope').preset).toBe('custom');
  });
});

describe('describeSchedule', () => {
  it('describes the presets in plain words', () => {
    expect(describeSchedule({ type: 'cron', cron: '*/15 * * * *' })).toBe('Every 15 min');
    expect(describeSchedule({ type: 'cron', cron: '0 * * * *' })).toBe('Hourly');
    expect(describeSchedule({ type: 'cron', cron: '0 8 * * *' })).toBe('Daily at 08:00');
    expect(describeSchedule({ type: 'cron', cron: '30 9 * * 1-5' })).toBe('Weekdays at 09:30');
    expect(describeSchedule({ type: 'cron', cron: '0 18 * * 3' })).toBe('Weekly on Wednesday at 18:00');
  });

  it('keeps a custom pattern readable and names the timezone', () => {
    expect(describeSchedule({ type: 'cron', cron: '30 7 1 * *' })).toBe('Cron 30 7 1 * *');
    expect(describeSchedule({ type: 'cron', cron: '0 8 * * 1-5', timezone: 'America/Sao_Paulo' })).toBe(
      'Weekdays at 08:00 · America/Sao_Paulo',
    );
    expect(describeSchedule({ type: 'webhook', secret: 'abc' })).toBe('Webhook');
  });
});

describe('weekdayName', () => {
  it('names the cron day of week, Sunday first', () => {
    expect(weekdayName(0)).toBe('Sunday');
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayName(5)).toBe('Friday');
    expect(weekdayName(6)).toBe('Saturday');
  });
});

describe('clock helpers', () => {
  it('formats and parses 24h times', () => {
    expect(formatClock(9, 5)).toBe('09:05');
    expect(parseClock('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseClock('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseClock('24:00')).toBeUndefined();
    expect(parseClock('9')).toBeUndefined();
  });
});

describe('relativeNextRun', () => {
  const now = Date.parse('2026-10-19T12:00:00.000Z');
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();

  it('counts down in minutes, hours and days, and flags an overdue run', () => {
    expect(relativeNextRun(undefined, now)).toBeUndefined();
    expect(relativeNextRun(at(-5), now)).toEqual({ key: 'routines.relative.overdue', count: 0 });
    expect(relativeNextRun(at(0), now)).toEqual({ key: 'routines.relative.underMinute', count: 0 });
    expect(relativeNextRun(at(20), now)).toEqual({ key: 'routines.relative.minutes', count: 20 });
    expect(relativeNextRun(at(180), now)).toEqual({ key: 'routines.relative.hours', count: 3 });
    expect(relativeNextRun(at(60 * 72), now)).toEqual({ key: 'routines.relative.days', count: 3 });
  });
});

describe('run duration', () => {
  const started = '2026-10-19T12:00:00.000Z';
  const after = (seconds: number) => new Date(Date.parse(started) + seconds * 1000).toISOString();

  it('formats seconds and minutes, and stays absent while running', () => {
    expect(formatRunDuration(started, undefined)).toBeUndefined();
    expect(formatRunDuration(started, after(42))).toBe('42s');
    expect(formatRunDuration(started, after(65))).toBe('1m 5s');
  });
});

describe('timezones', () => {
  it('offers a browser default and the supported zones, including a custom one', () => {
    expect(typeof browserTimezone()).toBe('string');
    expect(browserTimezone().length).toBeGreaterThan(0);
    const zones = timezoneOptions('America/Sao_Paulo');
    expect(zones).toContain('UTC');
    expect(zones).toContain('America/Sao_Paulo');
    expect(timezoneOptions('Mars/Olympus').includes('Mars/Olympus')).toBe(true);
  });
});
