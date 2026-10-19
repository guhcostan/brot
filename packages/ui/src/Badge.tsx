import type { HTMLAttributes, ReactElement } from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'attention';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** `attention` is reserved for errors and things that need the human now. */
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps): ReactElement {
  return <span className={cx('brot-badge', className)} data-tone={tone === 'neutral' ? undefined : tone} {...rest} />;
}
