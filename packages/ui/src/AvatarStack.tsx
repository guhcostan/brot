import type { CSSProperties, ReactElement } from 'react';
import type { AvatarMood, AvatarShape } from './avatar';
import { BotAvatar, AVATAR_SIZE_PX, type AvatarSize } from './BotAvatar';
import { cx } from './cx';
import type { AvatarColor } from './tokens';

export interface AvatarStackMember {
  id: string;
  shape: AvatarShape;
  color: AvatarColor;
  mood?: AvatarMood;
}

export interface AvatarStackProps {
  members: readonly AvatarStackMember[];
  /** Most avatars drawn. The rest show as a "+n" count. */
  max?: number;
  size?: AvatarSize | number;
  /** False hides the "+n" count, e.g. where the names are listed next to the stack. */
  showCount?: boolean;
  /** Accessible name for the whole group, e.g. "Capy, Onça and 2 more". Omit when the names are next to it. */
  label?: string;
  className?: string;
}

/**
 * Overlapping avatars for a room. Each avatar after the first casts a thin cutout in the row's
 * background (`--stack-cutout`, default `--surface`), so shapes stay distinct without a ring.
 */
export function AvatarStack({ members, max = 3, size = 'sm', showCount = true, label, className }: AvatarStackProps): ReactElement {
  const shown = members.slice(0, Math.max(1, max));
  const extra = members.length - shown.length;
  const px = typeof size === 'number' ? size : AVATAR_SIZE_PX[size];
  return (
    <span
      className={cx('brot-stack', className)}
      style={{ '--stack-size': `${px}px` } as CSSProperties}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {shown.map((member) => (
        <span key={member.id} className="brot-stack__item">
          <BotAvatar shape={member.shape} color={member.color} mood={member.mood} size={px} />
        </span>
      ))}
      {showCount && extra > 0 ? <span className="brot-stack__more">+{extra}</span> : null}
    </span>
  );
}
