import type { ReactElement } from 'react';
import type { TaskStatus } from '@brot/protocol';
import { cx } from './cx';

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export interface TaskStatusLabelProps {
  status: TaskStatus;
  /** Overrides the default English label. */
  label?: string;
  /** Hides the text visually; it stays available to screen readers. */
  iconOnly?: boolean;
  className?: string;
}

function Glyph({ status }: { status: TaskStatus }): ReactElement {
  switch (status) {
    case 'open':
      return <circle cx="8" cy="8" r="5.25" />;
    case 'in_progress':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M8 2.75A5.25 5.25 0 0 1 8 13.25Z" className="brot-task-status__fill" />
        </>
      );
    case 'blocked':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M6.5 6v4M9.5 6v4" />
        </>
      );
    case 'done':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M5.75 8.1 7.3 9.6l3-3.2" />
        </>
      );
    case 'failed':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M6.2 6.2l3.6 3.6M9.8 6.2l-3.6 3.6" />
        </>
      );
    case 'cancelled':
      return (
        <>
          <circle cx="8" cy="8" r="5.25" />
          <path d="M4.3 11.7l7.4-7.4" />
        </>
      );
  }
}

/**
 * A task status as an icon plus text, so it never relies on color. Only `failed` uses the attention
 * color, because it is an error (DESIGN.md section 4). Blocked stays neutral.
 */
export function TaskStatusLabel({ status, label, iconOnly = false, className }: TaskStatusLabelProps): ReactElement {
  const text = label ?? TASK_STATUS_LABELS[status];
  return (
    <span className={cx('brot-task-status', className)} data-status={status} title={iconOnly ? text : undefined}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <Glyph status={status} />
      </svg>
      <span className={iconOnly ? 'brot-sr-only' : 'brot-task-status__label'}>{text}</span>
    </span>
  );
}
