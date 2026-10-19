import type { ReactElement } from 'react';
import { cx } from './cx';

export interface TypingIndicatorProps {
  /** Screen-reader text, e.g. "Lua is working". */
  label: string;
  className?: string;
}

/** Three dots pulsing in sequence while a run is in progress. */
export function TypingIndicator({ label, className }: TypingIndicatorProps): ReactElement {
  return (
    <span className={cx('brot-typing', className)} role="status">
      <span className="brot-typing__dot" aria-hidden="true" />
      <span className="brot-typing__dot" aria-hidden="true" />
      <span className="brot-typing__dot" aria-hidden="true" />
      <span className="brot-sr-only">{label}</span>
    </span>
  );
}
