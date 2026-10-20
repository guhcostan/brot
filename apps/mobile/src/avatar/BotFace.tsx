import type { Bot } from '@brot/protocol';
import { parseAvatar, type AvatarMood } from '@brot/ui/avatar';
import type { ReactElement } from 'react';
import { BotAvatar, type AvatarSize } from './BotAvatar';

/** A bot's avatar from its stored `"<species>:<color>"`, falling back to a pick from its id. */
export function BotFace({
  bot,
  botId,
  mood = 'idle',
  size = 'md',
  label,
  animated,
}: {
  bot?: Pick<Bot, 'id' | 'avatar'>;
  botId: string;
  mood?: AvatarMood;
  size?: AvatarSize | number;
  label?: string;
  animated?: boolean;
}): ReactElement {
  const avatar = parseAvatar(bot?.avatar, bot?.id ?? botId);
  return <BotAvatar species={avatar.species} color={avatar.color} mood={mood} size={size} label={label} animated={animated} />;
}
