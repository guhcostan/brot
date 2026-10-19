import type { CSSProperties, ReactElement } from 'react';
import { cx } from './cx';

export const BOT_STATUSES = ['idle', 'working', 'waiting', 'error', 'ok'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

/** Text is always rendered next to the dot, so status never relies on color alone. */
export const BOT_STATUS_LABELS: Record<BotStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting for you',
  error: 'Error',
  ok: 'Done',
};

const STATUS_COLOR: Record<BotStatus, string> = {
  idle: 'var(--ink-2)',
  working: 'var(--river)',
  waiting: 'var(--live)',
  error: 'var(--danger)',
  ok: 'var(--ok)',
};

export interface StatusDotProps {
  status: BotStatus;
  /** Overrides the default label, e.g. "Sleeping · last seen 14:02". */
  label?: string;
  className?: string;
}

export function StatusDot({ status, label, className }: StatusDotProps): ReactElement {
  return (
    <span
      className={cx('brot-status', className)}
      data-status={status}
      style={{ '--status-color': STATUS_COLOR[status] } as CSSProperties}
    >
      <span className="brot-status__dot" aria-hidden="true" />
      <span>{label ?? BOT_STATUS_LABELS[status]}</span>
    </span>
  );
}
