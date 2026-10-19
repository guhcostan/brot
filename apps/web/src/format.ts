import { parseAvatar, type AvatarSpec } from '@brot/ui';
import type { Bot } from '@brot/protocol';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const usdFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 });
const countFormat = new Intl.NumberFormat('en-US');

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatUsd(value: number): string {
  return usdFormat.format(value);
}

export function formatCount(value: number): string {
  return countFormat.format(value);
}

/** The avatar shape and color for a bot. Unknown values fall back to a stable pick from the bot id. */
export function avatarOf(bot: Pick<Bot, 'avatar' | 'id'>): AvatarSpec {
  return parseAvatar(bot.avatar, bot.id);
}

/** A one-line gloss for a tool call: the first string argument, if any. */
export function summarizeArgs(args: Record<string, unknown>): string {
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.length > 0) return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  }
  return '';
}
