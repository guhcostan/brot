import type { ReactElement } from 'react';
import { BotAvatar, type AvatarColor, type AvatarMood, type AvatarShape } from '@brot/ui';

export interface LiveAvatarProps {
  shape: AvatarShape;
  color: AvatarColor;
  mood?: AvatarMood;
  size?: number;
  label?: string;
}

export default function LiveAvatar(props: LiveAvatarProps): ReactElement {
  return <BotAvatar {...props} />;
}
