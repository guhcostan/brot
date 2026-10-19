import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  AVATAR_VIEWBOX,
  EYE_STROKE,
  SHAPE_GEOMETRY,
  eyePaths,
  type AvatarMood,
  type AvatarShape,
  type ShapePart,
} from './avatar';
import { createBlinkScheduler } from './blink';
import { cx } from './cx';
import { useAvatarActive, usePrefersReducedMotion } from './motion';
import type { BotStatus } from './StatusDot';
import type { AvatarColor } from './tokens';

export type AvatarSize = 'sm' | 'md' | 'lg';

export const AVATAR_SIZE_PX: Record<AvatarSize, number> = { sm: 24, md: 32, lg: 48 };

/** Gap between blinks per mood, in ms. Moods without an entry keep their eyes still. */
const BLINK_RANGE: Partial<Record<AvatarMood, [number, number]>> = {
  idle: [3000, 7000],
  approval: [3000, 7000],
  thinking: [6000, 12000],
};

const SUCCESS_HOLD_MS = 1600;
const BLINK_MS = 130;
const MAX_FOLLOW = 2.2;

export interface BotAvatarProps {
  shape: AvatarShape;
  color: AvatarColor;
  mood?: AvatarMood;
  size?: AvatarSize | number;
  /** Accessible name. Omit when the bot's name is already next to the avatar. */
  label?: string;
  /** False renders a still face: no blinks, loops, or pointer following. */
  animated?: boolean;
  /**
   * Holds the eyes toward one side, e.g. toward the bot this one is talking to. Overrides the mood's
   * glance and scan loops. With reduced motion the eyes move without a transition.
   */
  gaze?: AvatarGaze;
  className?: string;
}

export type AvatarGaze = 'left' | 'right';

function Part({ part }: { part: ShapePart }): ReactElement {
  if (part.kind === 'circle') return <circle cx={part.cx} cy={part.cy} r={part.r} />;
  if (part.kind === 'rect') return <rect x={part.x} y={part.y} width={part.width} height={part.height} rx={part.rx} />;
  return part.roundness ? (
    <path d={part.d} strokeWidth={part.roundness} strokeLinejoin="round" className="brot-bot__round" />
  ) : (
    <path d={part.d} />
  );
}

/** Success shows the smiling hop, then settles back to idle on its own. */
function useDisplayMood(mood: AvatarMood): AvatarMood {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (mood !== 'success') return;
    const timer = setTimeout(() => setSettled(true), SUCCESS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [mood]);
  return mood === 'success' && settled ? 'idle' : mood;
}

/**
 * A bot's face: a flat shape in one avatar color with two eye strokes (DESIGN.md section 2).
 * Loops run in CSS and pause offscreen or in hidden tabs; blinks are scheduled at random gaps.
 */
export function BotAvatar({
  shape,
  color,
  mood = 'idle',
  size = 'md',
  label,
  animated = true,
  gaze,
  className,
}: BotAvatarProps): ReactElement {
  const rootRef = useRef<HTMLSpanElement>(null);
  const blinkRef = useRef<SVGGElement>(null);
  const followRef = useRef<SVGGElement>(null);
  const reduced = usePrefersReducedMotion();
  const live = animated && !reduced;
  const active = useAvatarActive(rootRef, live);
  const shown = useDisplayMood(mood);

  const geometry = SHAPE_GEOMETRY[shape];
  const [left, right] = eyePaths(shown, geometry.eyes);
  const px = typeof size === 'number' ? size : AVATAR_SIZE_PX[size];
  const blinkRange = BLINK_RANGE[shown];

  // A random phase keeps a row of bots out of sync. It is set after mount so server HTML stays deterministic
  // and hydrates without a mismatch; before that the loops simply start at zero.
  useLayoutEffect(() => {
    rootRef.current?.style.setProperty('--avatar-phase', Math.random().toFixed(3));
  }, []);

  useEffect(() => {
    if (!live || !active || !blinkRange) return;
    const scheduler = createBlinkScheduler({
      minMs: blinkRange[0],
      maxMs: blinkRange[1],
      onBlink: () => {
        blinkRef.current?.animate?.(
          [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.12)' }, { transform: 'scaleY(1)' }],
          { duration: BLINK_MS, easing: 'ease-in-out' },
        );
      },
    });
    scheduler.start();
    return () => scheduler.stop();
  }, [live, active, blinkRange]);

  useEffect(() => {
    const root = rootRef.current;
    const follow = followRef.current;
    if (!live || !root || !follow) return;
    const zone = root.closest<HTMLElement>('[data-avatar-zone]') ?? root;
    const onMove = (event: PointerEvent) => {
      const box = root.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width / 2);
      const dy = event.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, distance / (box.width * 2));
      const x = (dx / distance) * MAX_FOLLOW * reach;
      const y = (dy / distance) * MAX_FOLLOW * 0.7 * reach;
      follow.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    };
    const onLeave = () => {
      follow.style.transform = '';
    };
    zone.addEventListener('pointermove', onMove);
    zone.addEventListener('pointerleave', onLeave);
    return () => {
      zone.removeEventListener('pointermove', onMove);
      zone.removeEventListener('pointerleave', onLeave);
      follow.style.transform = '';
    };
  }, [live]);

  const style = {
    '--avatar-size': `${px}px`,
    '--avatar-fill': `var(--avatar-${color})`,
    '--avatar-eye': `var(--avatar-${color}-eye)`,
  } as CSSProperties;
  const eyeOrigin = `${geometry.eyes.x}px ${geometry.eyes.y}px`;

  return (
    <span
      ref={rootRef}
      className={cx('brot-bot', className)}
      style={style}
      data-shape={shape}
      data-mood={shown}
      data-gaze={gaze}
      data-animated={live ? 'true' : undefined}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox={`0 0 ${AVATAR_VIEWBOX} ${AVATAR_VIEWBOX}`} width={px} height={px} focusable="false">
        <g className="brot-bot__body">
          <g transform={geometry.rotate ? `rotate(${geometry.rotate} 20 20)` : undefined}>
            <g className="brot-bot__shape">
              {geometry.parts.map((part, index) => (
                <Part key={index} part={part} />
              ))}
            </g>
            <g ref={followRef} className="brot-bot__follow">
              <g className="brot-bot__look" style={{ transformOrigin: eyeOrigin }}>
                <g ref={blinkRef} className="brot-bot__blink" style={{ transformOrigin: eyeOrigin }}>
                  <path className="brot-bot__eye" d={left} strokeWidth={EYE_STROKE} style={{ d: `path("${left}")` } as CSSProperties} />
                  <path className="brot-bot__eye" d={right} strokeWidth={EYE_STROKE} style={{ d: `path("${right}")` } as CSSProperties} />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}

export interface BrandMarkProps {
  size?: AvatarSize | number;
  /** Accessible name. Omit when the "brot" wordmark sits next to the mark. */
  label?: string;
  className?: string;
}

/** The black squircle with idle eyes. Still, like the favicon. */
export function BrandMark({ size = 'sm', label, className }: BrandMarkProps): ReactElement {
  return (
    <BotAvatar shape="squircle" color="black" size={size} label={label} animated={false} className={cx('brot-brand', className)} />
  );
}

/** The avatar mood that matches a bot status in the sidebar and thread header. */
export const STATUS_MOOD: Record<BotStatus, AvatarMood> = {
  idle: 'idle',
  working: 'thinking',
  waiting: 'approval',
  error: 'error',
  ok: 'success',
  sleeping: 'sleeping',
};
