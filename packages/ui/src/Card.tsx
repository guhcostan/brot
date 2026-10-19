import type { HTMLAttributes, ReactElement } from 'react';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'default' | 'none';
}

/** Flat: a --line border on --surface, no shadow. */
export function Card({ padding = 'default', className, ...rest }: CardProps): ReactElement {
  return <div className={cx('brot-card', className)} data-padding={padding} {...rest} />;
}
