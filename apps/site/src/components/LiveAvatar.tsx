import type { ReactElement } from 'react';
import { BotAvatar, type AvatarColor, type AvatarGaze, type AvatarMood, type AvatarSpecies } from '@brot/ui';

export interface LiveAvatarProps {
  species: AvatarSpecies;
  color: AvatarColor;
  mood?: AvatarMood;
  gaze?: AvatarGaze;
  size?: number;
  label?: string;
}

/** A BotAvatar island for Astro pages: hydrates so the bot blinks, glances and follows the pointer. */
export default function LiveAvatar(props: LiveAvatarProps): ReactElement {
  return <BotAvatar {...props} />;
}
