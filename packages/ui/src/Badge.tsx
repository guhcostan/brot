import type { HTMLAttributes, ReactElement } from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'brand' | 'live' | 'warn' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps): ReactElement {
  return (
    <span
      className={cx('brot-badge', className)}
      data-tone={tone === 'neutral' ? undefined : tone}
      {...rest}
    />
  );
}
