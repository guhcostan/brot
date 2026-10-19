import type { ReactElement } from 'react';
import { BotAvatar, type AvatarColor, type AvatarMood, type AvatarSpecies } from '@brot/ui';

export interface LiveAvatarProps {
  species: AvatarSpecies;
  color: AvatarColor;
  mood?: AvatarMood;
  size?: number;
  label?: string;
}

export default function LiveAvatar(props: LiveAvatarProps): ReactElement {
  return <BotAvatar {...props} />;
}
