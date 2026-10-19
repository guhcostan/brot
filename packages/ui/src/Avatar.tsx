import type { CSSProperties, ReactElement } from 'react';
import { cx } from './cx';
import { Fauna, type FaunaKind } from './fauna';

export type AvatarSize = 'sm' | 'md' | 'lg';

const AVATAR_SIZE: Record<AvatarSize, { px: number; radius: string; face: number }> = {
  sm: { px: 28, radius: 'var(--r-md)', face: 20 },
  md: { px: 40, radius: 'var(--r-lg)', face: 30 },
  lg: { px: 56, radius: 'var(--r-lg)', face: 42 },
};

export interface AvatarProps {
  kind: FaunaKind;
  size?: AvatarSize;
  /** Accessible name for the animal. Omit when the bot's name sits next to the avatar. */
  label?: string;
  className?: string;
}

/** A rounded-squircle tile holding a fauna face. Bots read as creatures, not contacts. */
export function Avatar({ kind, size = 'md', label, className }: AvatarProps): ReactElement {
  const spec = AVATAR_SIZE[size];
  const style = {
    '--avatar-size': `${spec.px}px`,
    '--avatar-radius': spec.radius,
  } as CSSProperties;
  return (
    <span className={cx('brot-avatar', className)} style={style} data-size={size}>
      <Fauna kind={kind} size={spec.face} label={label} />
    </span>
  );
}
