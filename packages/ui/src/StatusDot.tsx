import type { ReactElement } from 'react';
import { cx } from './cx';

export const BOT_STATUSES = ['idle', 'working', 'waiting', 'error', 'ok', 'sleeping'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

/** Text is always rendered next to the dot, so status never relies on color alone. */
export const BOT_STATUS_LABELS: Record<BotStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting for you',
  error: 'Error',
  ok: 'Done',
  sleeping: 'Sleeping',
};

export interface StatusDotProps {
  status: BotStatus;
  /** Overrides the default label, e.g. "Sleeping · last seen 14:02". */
  label?: string;
  className?: string;
}

/** Ink tones for every status; --attention only for waiting and error. */
export function StatusDot({ status, label, className }: StatusDotProps): ReactElement {
  return (
    <span className={cx('brot-status', className)} data-status={status}>
      <span className="brot-status__dot" aria-hidden="true" />
      <span className="brot-status__label">{label ?? BOT_STATUS_LABELS[status]}</span>
    </span>
  );
}
