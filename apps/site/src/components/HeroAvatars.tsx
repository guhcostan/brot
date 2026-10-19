import { useEffect, useState, type ReactElement } from 'react';
import { BotAvatar, prefersReducedMotion, type AvatarColor, type AvatarMood, type AvatarShape } from '@brot/ui';

const ROW: ReadonlyArray<{ shape: AvatarShape; color: AvatarColor }> = [
  { shape: 'circle', color: 'violet' },
  { shape: 'cloud', color: 'teal' },
  { shape: 'triangle', color: 'orange' },
  { shape: 'squircle', color: 'black' },
  { shape: 'blob', color: 'blue' },
  { shape: 'drop', color: 'pink' },
  { shape: 'tilted', color: 'amber' },
];

const HOP_EVERY_MS = 6500;
const HOP_HOLD_MS = 1800;

export interface HeroAvatarsProps {
  label: string;
}

/** The hero row. Every few seconds one bot gives a small happy hop, so the team reads as present. */
export default function HeroAvatars({ label }: HeroAvatarsProps): ReactElement {
  const [hopping, setHopping] = useState<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let last = -1;
    let reset: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      let next = Math.floor(Math.random() * ROW.length);
      if (next === last) next = (next + 1) % ROW.length;
      last = next;
      setHopping(next);
      reset = setTimeout(() => setHopping(null), HOP_HOLD_MS);
    }, HOP_EVERY_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(reset);
    };
  }, []);

  return (
    <div className="hero-avatars" role="img" aria-label={label}>
      {ROW.map((bot, index) => {
        const mood: AvatarMood = hopping === index ? 'success' : 'idle';
        return <BotAvatar key={bot.shape} shape={bot.shape} color={bot.color} mood={mood} size={64} />;
      })}
    </div>
  );
}
