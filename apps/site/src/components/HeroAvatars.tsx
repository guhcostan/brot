import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { BotAvatar, prefersReducedMotion, type AvatarColor, type AvatarGaze, type AvatarMood, type AvatarSpecies } from '@brot/ui';

interface Head {
  species: AvatarSpecies;
  color: AvatarColor;
  mood: AvatarMood;
  gaze?: AvatarGaze;
  /** Center of the head, in % of the band. */
  x: number;
  y: number;
  /** Diameter as a multiple of the band height. */
  size: number;
}

/*
 * Overlapping heads cropped by the band, after the reference: big side heads, mostly asleep or
 * glancing at the one in front, and one awake capybara in the middle that follows the pointer.
 * Listed back to front.
 */
const HEADS: readonly Head[] = [
  { species: 'onca', color: 'violet', mood: 'sleeping', x: 14, y: 16, size: 1.1 },
  { species: 'tucano', color: 'orange', mood: 'idle', gaze: 'left', x: 78, y: 22, size: 0.95 },
  { species: 'lobo', color: 'gray', mood: 'idle', gaze: 'right', x: 6, y: 92, size: 1.05 },
  { species: 'boto', color: 'blue', mood: 'sleeping', x: 95, y: 72, size: 1.1 },
  { species: 'mico', color: 'teal', mood: 'thinking', x: 30, y: 82, size: 0.75 },
  { species: 'jabuti', color: 'amber', mood: 'idle', gaze: 'left', x: 71, y: 88, size: 0.78 },
  { species: 'capivara', color: 'white', mood: 'idle', x: 50, y: 52, size: 0.98 },
];

const HOP_EVERY_MS = 6500;
const HOP_HOLD_MS = 1800;

export interface HeroAvatarsProps {
  label: string;
}

/** The hero band. Every few seconds one awake bot gives a small happy hop, so the team reads as present. */
export default function HeroAvatars({ label }: HeroAvatarsProps): ReactElement {
  const [hopping, setHopping] = useState<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const awake = HEADS.flatMap((head, index) => (head.mood === 'sleeping' ? [] : [index]));
    let last = -1;
    let reset: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      let next = awake[Math.floor(Math.random() * awake.length)] ?? -1;
      if (next === last) next = awake[(awake.indexOf(next) + 1) % awake.length] ?? -1;
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
    <div className="hero-band" role="img" aria-label={label}>
      {HEADS.map((head, index) => (
        <span
          key={head.species}
          className="hero-band__head"
          style={{ '--x': `${head.x}%`, '--y': `${head.y}%`, '--k': head.size } as CSSProperties}
        >
          <BotAvatar
            species={head.species}
            color={head.color}
            mood={hopping === index ? 'success' : head.mood}
            gaze={head.gaze}
            size={160}
          />
        </span>
      ))}
    </div>
  );
}
