import type { Bot } from '@brot/protocol';
import { parseAvatar, type AvatarMood } from '@brot/ui/avatar';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { BotAvatar } from '../avatar/BotAvatar';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface AvatarStackProps {
  bots: Bot[];
  size?: number;
  /** Heads after this many collapse into a "+n". */
  max?: number;
  moodFor?: (bot: Bot) => AvatarMood;
}

/** Overlapping animal heads for a room (DESIGN.md section 2: group views may overlap heads). */
export function AvatarStack({ bots, size = 32, max = 3, moodFor }: AvatarStackProps): ReactElement {
  const theme = useTheme();
  const shown = bots.slice(0, max);
  const extra = bots.length - shown.length;
  const overlap = Math.round(size * 0.32);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible={false} importantForAccessibility="no-hide-descendants">
      {shown.map((bot, index) => {
        const avatar = parseAvatar(bot.avatar, bot.id);
        return (
          <View key={bot.id} style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: shown.length - index }}>
            <BotAvatar species={avatar.species} color={avatar.color} mood={moodFor?.(bot) ?? 'idle'} size={size} />
          </View>
        );
      })}
      {extra > 0 ? (
        <View
          style={{
            marginLeft: -overlap / 2,
            minWidth: size * 0.75,
            height: size * 0.75,
            borderRadius: theme.radius.full,
            backgroundColor: theme.color.surface2,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text variant="caption" tone="ink2" numeric>
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
