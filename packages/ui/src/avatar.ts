import { AVATAR_COLOR_NAMES, type AvatarColor } from './tokens';

/*
 * Avatar geometry and encoding from DESIGN.md section 2. DOM-free, so the React Native app can
 * draw the same shapes. Everything is drawn in a 40-unit viewBox.
 */

export const AVATAR_SHAPES = ['circle', 'squircle', 'tilted', 'cloud', 'triangle', 'blob', 'drop'] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

export const AVATAR_MOODS = ['idle', 'thinking', 'approval', 'sleeping', 'error', 'success'] as const;
export type AvatarMood = (typeof AVATAR_MOODS)[number];

export interface AvatarSpec {
  shape: AvatarShape;
  color: AvatarColor;
}

export const AVATAR_VIEWBOX = 40;

export type ShapePart =
  | { kind: 'path'; d: string; roundness?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

export interface ShapeGeometry {
  /** Filled parts in the avatar color. `roundness` is a same-color round-joined stroke that softens corners. */
  parts: ShapePart[];
  /** Midpoint between the eyes. */
  eyes: { x: number; y: number };
  /** Degrees, around the viewBox center. */
  rotate?: number;
}

/*
 * Sizes are tuned by eye, not by bounding box: shapes with corners or points get a larger box so
 * all seven read at the same optical size as the r=17 circle.
 */
export const SHAPE_GEOMETRY: Record<AvatarShape, ShapeGeometry> = {
  circle: {
    parts: [{ kind: 'circle', cx: 20, cy: 20, r: 17 }],
    eyes: { x: 20, y: 17.5 },
  },
  squircle: {
    parts: [{ kind: 'path', d: 'M20 4C31.6 4 36 8.4 36 20C36 31.6 31.6 36 20 36C8.4 36 4 31.6 4 20C4 8.4 8.4 4 20 4Z' }],
    eyes: { x: 20, y: 17.5 },
  },
  tilted: {
    parts: [{ kind: 'rect', x: 5, y: 5, width: 30, height: 30, rx: 9 }],
    eyes: { x: 20, y: 17.5 },
    rotate: 12,
  },
  cloud: {
    parts: [
      { kind: 'circle', cx: 12, cy: 21.5, r: 8.5 },
      { kind: 'circle', cx: 21.5, cy: 15, r: 11.5 },
      { kind: 'circle', cx: 30, cy: 22, r: 7.5 },
      { kind: 'rect', x: 3.5, y: 19, width: 34, height: 15.5, rx: 7.75 },
    ],
    eyes: { x: 20.5, y: 19.5 },
  },
  triangle: {
    parts: [{ kind: 'path', d: 'M20 8.5L33.2 31L6.8 31Z', roundness: 8 }],
    eyes: { x: 20, y: 23 },
  },
  blob: {
    parts: [
      {
        kind: 'path',
        d: 'M24.5 3.7C28.8 4.9 33.7 11.4 35.1 16.3C36.4 21.1 35.6 29.6 32.4 32.7C29.3 35.9 20.9 36.3 16.1 35C11.3 33.6 4.8 29 3.6 24.7C2.3 20.4 5.2 12.5 8.7 9C12.2 5.5 20.1 2.5 24.5 3.7Z',
      },
    ],
    eyes: { x: 20, y: 18.5 },
  },
  drop: {
    parts: [
      {
        kind: 'path',
        d: 'M20 3.5C22.5 8 33 14.5 33 23.5A13 13 0 0 1 7 23.5C7 14.5 17.5 8 20 3.5Z',
        roundness: 2.5,
      },
    ],
    eyes: { x: 20, y: 22.5 },
  },
};

export const EYE_STROKE = 3;
const EYE_HALF_GAP = 5;

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const quad = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number) =>
  `M${fmt(x1)} ${fmt(y1)}Q${fmt(cx)} ${fmt(cy)} ${fmt(x2)} ${fmt(y2)}`;

/**
 * Eye strokes for a mood, as [left, right] path data. Every mood uses the same `M Q` command
 * structure so CSS can interpolate between them.
 */
export function eyePaths(mood: AvatarMood, anchor: { x: number; y: number }): [string, string] {
  const eye = (side: -1 | 1): string => {
    const x = anchor.x + side * EYE_HALF_GAP;
    const y = anchor.y;
    switch (mood) {
      case 'idle':
        return quad(x, y - 2.5, x, y, x, y + 2.5);
      case 'thinking':
        return quad(x, y - 2.1, x, y, x, y + 2.1);
      case 'approval':
        return quad(x, y - 3.8, x, y - 0.3, x, y + 3.2);
      case 'sleeping':
        return quad(x - 2.6, y + 1, x, y + 1, x + 2.6, y + 1);
      case 'error':
        return quad(x + side * 1.4, y + 2.3, x, y, x - side * 1.4, y - 2.3);
      case 'success':
        return quad(x - 2.6, y + 1.3, x, y - 3.1, x + 2.6, y + 1.3);
    }
  };
  return [eye(-1), eye(1)];
}

function isShape(value: string): value is AvatarShape {
  return (AVATAR_SHAPES as readonly string[]).includes(value);
}

function isColor(value: string): value is AvatarColor {
  return (AVATAR_COLOR_NAMES as readonly string[]).includes(value);
}

/** 32-bit FNV-1a. Stable across platforms, so a bot keeps its look everywhere. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Parses a `bot.avatar` value of the form "shape:color". Any missing or unknown part falls back to
 * a deterministic pick from `seed` (the bot id).
 */
export function parseAvatar(value: string | undefined, seed: string): AvatarSpec {
  const [rawShape = '', rawColor = ''] = (value ?? '').trim().toLowerCase().split(':');
  const hash = hashSeed(seed);
  const shape = isShape(rawShape) ? rawShape : AVATAR_SHAPES[hash % AVATAR_SHAPES.length]!;
  const color = isColor(rawColor) ? rawColor : AVATAR_COLOR_NAMES[(hash >>> 8) % AVATAR_COLOR_NAMES.length]!;
  return { shape, color };
}

/** Serializes an avatar spec back to its `bot.avatar` form. */
export function formatAvatar(spec: AvatarSpec): string {
  return `${spec.shape}:${spec.color}`;
}
