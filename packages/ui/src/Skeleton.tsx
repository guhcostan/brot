import type { CSSProperties, ReactElement } from 'react';
import { cx } from './cx';

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** `circle` for avatar placeholders. */
  shape?: 'line' | 'block' | 'circle';
  className?: string;
}

/** A quiet placeholder that pulses in opacity while content loads. Still under reduced motion. */
export function Skeleton({ width, height, shape = 'line', className }: SkeletonProps): ReactElement {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return <span className={cx('brot-skeleton', className)} data-shape={shape} style={style} aria-hidden="true" />;
}
