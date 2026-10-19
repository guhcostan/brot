import { createContext, useContext, type ReactElement } from 'react';
import type { Bot, Task } from '@brot/protocol';
import { BotAvatar, type AvatarGaze, type AvatarMood, type AvatarSize } from '@brot/ui';
import type { Room } from '../data/client';
import { avatarOf } from '../format';
import { t } from '../i18n';

export interface TeamContextValue {
  bots: Readonly<Record<string, Bot>>;
  rooms: readonly Room[];
  tasks: Readonly<Record<string, Task>>;
  /** Bots with a pending approval anywhere, so a blocked task can say it waits for you. */
  waitingBots: ReadonlySet<string>;
  openBot: (botId: string) => void;
  openRoom: (roomId: string) => void;
  openTask: (taskId: string) => void;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export const TeamProvider = TeamContext.Provider;

export function useTeam(): TeamContextValue {
  const value = useContext(TeamContext);
  if (!value) throw new Error('useTeam needs a TeamProvider');
  return value;
}

/** A bot's display name; a deleted bot reads as "A bot" rather than its id. */
export function useBotName(): (botId: string | undefined) => string {
  const { bots } = useTeam();
  return (botId) => (botId ? (bots[botId]?.name ?? t('team.unknownBot')) : t('team.unknownBot'));
}

export interface TeamAvatarProps {
  botId: string;
  size?: AvatarSize | number;
  mood?: AvatarMood;
  gaze?: AvatarGaze;
  label?: string;
  className?: string;
}

/** A bot's avatar by id. Falls back to the deterministic look for a bot that is not loaded. */
export function TeamAvatar({ botId, size = 'sm', mood, gaze, label, className }: TeamAvatarProps): ReactElement {
  const { bots } = useTeam();
  const avatar = avatarOf(bots[botId] ?? { id: botId });
  return <BotAvatar shape={avatar.shape} color={avatar.color} size={size} mood={mood} gaze={gaze} label={label} className={className} />;
}

/** Thread activity mapped to the avatar's mood (DESIGN.md section 2). */
export function moodOf(activity: 'waiting' | 'working' | 'idle'): AvatarMood {
  if (activity === 'waiting') return 'approval';
  if (activity === 'working') return 'thinking';
  return 'idle';
}
