import type { HTMLAttributes, ReactElement } from 'react';
import { cx } from './cx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'default' | 'none';
}

export function Card({ padding = 'default', className, ...rest }: CardProps): ReactElement {
  return <div className={cx('brot-card', className)} data-padding={padding} {...rest} />;
}
