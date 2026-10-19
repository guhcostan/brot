import { AVATAR_COLOR_NAMES, type AvatarColor } from './tokens';

/*
 * Avatar geometry and encoding from DESIGN.md section 2: flat heads of Brazilian animals.
 * DOM-free, so the React Native app draws the same species. Everything is drawn in a 40-unit viewBox.
 */

export const AVATAR_SPECIES = [
  'capivara',
  'onca',
  'tucano',
  'arara',
  'tamandua',
  'boto',
  'preguica',
  'mico',
  'lobo',
  'jabuti',
] as const;
export type AvatarSpecies = (typeof AVATAR_SPECIES)[number];

/** The geometric shapes avatars used before the animals. Still accepted when parsing stored values. */
export const LEGACY_AVATAR_SHAPES = ['circle', 'squircle', 'tilted', 'cloud', 'triangle', 'blob', 'drop'] as const;
export type LegacyAvatarShape = (typeof LEGACY_AVATAR_SHAPES)[number];

/** Which species each legacy shape becomes. */
export const LEGACY_SHAPE_SPECIES: Record<LegacyAvatarShape, AvatarSpecies> = {
  circle: 'capivara',
  squircle: 'capivara',
  tilted: 'onca',
  cloud: 'preguica',
  triangle: 'lobo',
  blob: 'mico',
  drop: 'boto',
};

/** @deprecated Use `AvatarSpecies`. Accepts legacy shape names too, which resolve to a species. */
export type AvatarShape = AvatarSpecies | LegacyAvatarShape;
/** @deprecated Use `AVATAR_SPECIES`. */
export const AVATAR_SHAPES = LEGACY_AVATAR_SHAPES;

export const AVATAR_MOODS = ['idle', 'thinking', 'approval', 'sleeping', 'error', 'success'] as const;
export type AvatarMood = (typeof AVATAR_MOODS)[number];

export interface AvatarSpec {
  species: AvatarSpecies;
  color: AvatarColor;
  /** @deprecated Same value as `species`, kept for callers written against shapes. */
  shape: AvatarSpecies;
}

export const AVATAR_VIEWBOX = 40;

export interface Point {
  x: number;
  y: number;
}

/** `fill` is the head color, `tone` the one darker or lighter step of it. */
export type AvatarInk = 'fill' | 'tone';

export type AvatarPart =
  | { kind: 'path'; d: string; ink: AvatarInk }
  | { kind: 'circle'; cx: number; cy: number; r: number; ink: AvatarInk }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotate?: number; ink: AvatarInk }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number; ink: AvatarInk };

export interface SpeciesGeometry {
  /** Ears and tufts, drawn behind the head. They perk and droop with the mood around `backPivot`. */
  back: AvatarPart[];
  backPivot: Point;
  /** The head silhouette and its tone details. */
  head: AvatarPart[];
  /** A beak or rostrum drawn over the head. It lifts and dips with the mood around `frontPivot`. */
  front: AvatarPart[];
  frontPivot: Point;
  /** Midpoint between the eyes. */
  eyes: Point;
  /** Half the distance between the eyes. */
  eyeGap: number;
}

export const EYE_STROKE = 2.8;
export const EYE_HALF_GAP = 5;

const fill = 'fill' as const;
const tone = 'tone' as const;

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const mirrorX = (x: number) => AVATAR_VIEWBOX - x;

/** Mirrors path data written with absolute M/L/C/Q/Z commands across the vertical center line. */
function mirrorPath(d: string): string {
  return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${fmt(mirrorX(Number(x)))} ${y}`);
}

function pair(part: AvatarPart): [AvatarPart, AvatarPart] {
  switch (part.kind) {
    case 'circle':
      return [part, { ...part, cx: mirrorX(part.cx) }];
    case 'ellipse':
      return [part, { ...part, cx: mirrorX(part.cx), rotate: part.rotate ? -part.rotate : undefined }];
    case 'rect':
      return [part, { ...part, x: AVATAR_VIEWBOX - part.x - part.width }];
    case 'path':
      return [part, { ...part, d: mirrorPath(part.d) }];
  }
}

const both = (...parts: AvatarPart[]): AvatarPart[] => parts.flatMap(pair);

const mirrorPoint = (p: Point): Point => ({ x: mirrorX(p.x), y: p.y });
const mirrorPart = (part: AvatarPart): AvatarPart => pair(part)[1];

/** Profile heads are drawn facing right, then turned left so overlapping stacks never hide a beak. */
function facingLeft(g: SpeciesGeometry): SpeciesGeometry {
  return {
    back: g.back.map(mirrorPart),
    backPivot: mirrorPoint(g.backPivot),
    head: g.head.map(mirrorPart),
    front: g.front.map(mirrorPart),
    frontPivot: mirrorPoint(g.frontPivot),
    eyes: mirrorPoint(g.eyes),
    eyeGap: g.eyeGap,
  };
}

/*
 * Tuned by eye at 24, 32 and 72px rather than by bounding box: every head reads at about the size
 * of an r=16 circle, and beaks, snouts and ears may run past it.
 */
export const SPECIES_GEOMETRY: Record<AvatarSpecies, SpeciesGeometry> = {
  capivara: {
    back: both({ kind: 'circle', cx: 9.6, cy: 9.4, r: 3.9, ink: fill }, { kind: 'circle', cx: 9.6, cy: 9.4, r: 1.9, ink: tone }),
    backPivot: { x: 20, y: 14 },
    head: [
      { kind: 'rect', x: 4.5, y: 6.5, width: 31, height: 28.5, rx: 11.5, ink: fill },
      { kind: 'rect', x: 8.5, y: 20.5, width: 23, height: 14.5, rx: 7.25, ink: tone },
      ...both({ kind: 'ellipse', cx: 15.6, cy: 25.6, rx: 1.7, ry: 1.25, ink: fill }),
    ],
    front: [],
    frontPivot: { x: 20, y: 28 },
    eyes: { x: 20, y: 14.6 },
    eyeGap: EYE_HALF_GAP,
  },
  onca: {
    back: both(
      { kind: 'circle', cx: 9.2, cy: 10.2, r: 4.8, ink: fill },
      { kind: 'circle', cx: 9.2, cy: 10.2, r: 2.3, ink: tone },
    ),
    backPivot: { x: 20, y: 16 },
    head: [
      { kind: 'circle', cx: 20, cy: 21.5, r: 15.2, ink: fill },
      { kind: 'circle', cx: 20, cy: 9.8, r: 1.8, ink: tone },
      ...both(
        { kind: 'circle', cx: 14.2, cy: 11.4, r: 1.3, ink: tone },
        { kind: 'circle', cx: 8.4, cy: 21.6, r: 1.7, ink: tone },
        { kind: 'circle', cx: 10.4, cy: 27.6, r: 1.25, ink: tone },
        { kind: 'circle', cx: 6.7, cy: 26.4, r: 0.9, ink: tone },
      ),
      { kind: 'path', d: 'M16.6 24.6L23.4 24.6C24.4 24.6 24.9 25.7 24.2 26.4L20.9 29.6C20.4 30.1 19.6 30.1 19.1 29.6L15.8 26.4C15.1 25.7 15.6 24.6 16.6 24.6Z', ink: tone },
    ],
    front: [],
    frontPivot: { x: 20, y: 26 },
    eyes: { x: 20, y: 19 },
    eyeGap: EYE_HALF_GAP,
  },
  tucano: facingLeft({
    back: [],
    backPivot: { x: 15, y: 21 },
    head: [{ kind: 'circle', cx: 14.5, cy: 21, r: 13.5, ink: fill }],
    front: [
      {
        kind: 'path',
        d: 'M20.5 12.8C28.5 10.8 36.4 14 38.9 23.6C39.5 25.9 38 27.3 36.3 26C32.7 23.3 28 26.4 21.5 28.4C18.6 23.4 18.3 17.4 20.5 12.8Z',
        ink: tone,
      },
    ],
    frontPivot: { x: 22, y: 20 },
    eyes: { x: 11.5, y: 19 },
    eyeGap: EYE_HALF_GAP,
  }),
  arara: facingLeft({
    back: [],
    backPivot: { x: 16, y: 12 },
    head: [
      { kind: 'circle', cx: 15.6, cy: 19.6, r: 14, ink: fill },
      { kind: 'ellipse', cx: 19.6, cy: 21.4, rx: 4.6, ry: 5.8, rotate: -10, ink: tone },
    ],
    front: [
      {
        kind: 'path',
        d: 'M24.6 15.4C31.6 14.6 37 19.2 36.8 26C36.7 30.2 34.6 33.8 31.4 36.2C30.6 36.8 29.6 36 30.1 35.1C30.9 33.4 30.6 31.6 29.2 30.8C27.8 30 26.2 30.1 24.4 30.6C25.6 25.6 25.8 20.4 24.6 15.4Z',
        ink: tone,
      },
    ],
    frontPivot: { x: 25.5, y: 22 },
    eyes: { x: 13, y: 17.8 },
    eyeGap: EYE_HALF_GAP,
  }),
  tamandua: facingLeft({
    back: [
      { kind: 'circle', cx: 8.4, cy: 9.4, r: 3.8, ink: fill },
      { kind: 'circle', cx: 8.4, cy: 9.4, r: 1.8, ink: tone },
    ],
    backPivot: { x: 13, y: 16 },
    head: [
      { kind: 'circle', cx: 13.5, cy: 19.5, r: 11.6, ink: fill },
      {
        kind: 'path',
        d: 'M17 8.6C21.6 9.6 24 14.4 27.4 17.8C30.4 20.8 34.4 23 37.4 24.6C39.3 25.6 39 28.6 36.8 28.9C30 29.6 22.6 29.8 14.6 31Z',
        ink: fill,
      },
      { kind: 'circle', cx: 37.4, cy: 26.8, r: 2.2, ink: tone },
    ],
    front: [],
    frontPivot: { x: 30, y: 26 },
    eyes: { x: 12.6, y: 18.6 },
    eyeGap: EYE_HALF_GAP,
  }),
  boto: facingLeft({
    back: [],
    backPivot: { x: 16, y: 20 },
    head: [
      {
        kind: 'path',
        d: 'M2.6 21.6C2.6 11.6 9 4.6 17.2 4.6C24.8 4.6 30.2 9.8 30.2 16.2C30.2 18.4 29.6 20.2 28.4 21.6L37.8 24.2C39.7 24.7 39.7 27.7 37.8 28L28.4 29.2C26.4 31.8 22.4 33.4 17 33.4C9 33.4 2.6 29.4 2.6 21.6Z',
        ink: fill,
      },
      { kind: 'path', d: 'M28.4 21.6L37.8 24.2C39.7 24.7 39.7 27.7 37.8 28L28.4 29.2C29.4 26.8 29.4 24 28.4 21.6Z', ink: tone },
      { kind: 'ellipse', cx: 14.4, cy: 7.8, rx: 2.1, ry: 1.1, rotate: -16, ink: tone },
    ],
    front: [],
    frontPivot: { x: 28, y: 25 },
    eyes: { x: 15.4, y: 18.2 },
    eyeGap: EYE_HALF_GAP,
  }),
  preguica: {
    back: [],
    backPivot: { x: 20, y: 20 },
    head: [
      { kind: 'ellipse', cx: 20, cy: 20.5, rx: 16.2, ry: 14.5, ink: fill },
      ...both({ kind: 'ellipse', cx: 12.4, cy: 20.4, rx: 6.4, ry: 3, rotate: -24, ink: tone }),
      { kind: 'ellipse', cx: 20, cy: 26.4, rx: 2.7, ry: 2, ink: tone },
    ],
    front: [],
    frontPivot: { x: 20, y: 26 },
    eyes: { x: 20, y: 19.2 },
    eyeGap: EYE_HALF_GAP,
  },
  mico: {
    back: both({ kind: 'path', d: 'M13 19.5L1.4 22.4Q-1 18.8 1.6 15.6Q1.4 11.6 5.2 10.4Q7.2 6.8 11.2 8Z', ink: tone }),
    backPivot: { x: 20, y: 18 },
    head: [
      { kind: 'circle', cx: 20, cy: 22, r: 12.2, ink: fill },
      { kind: 'ellipse', cx: 20, cy: 13.8, rx: 2.4, ry: 1.8, ink: tone },
      { kind: 'ellipse', cx: 20, cy: 28.4, rx: 3.8, ry: 2.7, ink: tone },
    ],
    front: [],
    frontPivot: { x: 20, y: 28 },
    eyes: { x: 20, y: 21.4 },
    eyeGap: 4.6,
  },
  lobo: {
    back: both(
      { kind: 'path', d: 'M7.8 19L6.6 3.4C6.5 1.9 7.9 1.2 9 2.1L18.6 10Z', ink: fill },
      { kind: 'path', d: 'M9.6 14.6L9 5.8L15.4 11.2Z', ink: tone },
    ),
    backPivot: { x: 20, y: 14 },
    head: [
      {
        kind: 'path',
        d: 'M20 7.5C29.5 7.5 34.5 12.6 34.5 18.6C34.5 23.6 29 27 25 31.6C22.8 34.2 17.2 34.2 15 31.6C11 27 5.5 23.6 5.5 18.6C5.5 12.6 10.5 7.5 20 7.5Z',
        ink: fill,
      },
      {
        kind: 'path',
        d: 'M15.4 26.4C16.6 24.6 23.4 24.6 24.6 26.4L25 31.6C22.8 34.2 17.2 34.2 15 31.6Z',
        ink: tone,
      },
    ],
    front: [],
    frontPivot: { x: 20, y: 28 },
    eyes: { x: 20, y: 18 },
    eyeGap: EYE_HALF_GAP,
  },
  jabuti: facingLeft({
    back: [],
    backPivot: { x: 18, y: 20 },
    head: [
      { kind: 'rect', x: 6.6, y: 24, width: 6, height: 9, rx: 3, ink: fill },
      { kind: 'rect', x: 20.4, y: 24, width: 6, height: 9, rx: 3, ink: fill },
      { kind: 'path', d: 'M2.5 26C2.5 15.6 9.4 7.5 18 7.5C26.6 7.5 33.5 15.6 33.5 26C33.5 27.3 32.8 28 31.5 28L4.5 28C3.2 28 2.5 27.3 2.5 26Z', ink: tone },
      { kind: 'path', d: 'M14.6 11.2L21.4 11.2L24.2 16.4L21.4 21.6L14.6 21.6L11.8 16.4Z', ink: fill },
      { kind: 'path', d: 'M6.6 16.4L10.2 16.4L12.8 21.2L10.8 25.4L4.6 25.4C4.6 22 5.2 19 6.6 16.4Z', ink: fill },
      { kind: 'path', d: 'M25.8 16.4L29.4 16.4C30.8 19 31.4 22 31.4 25.4L25.2 25.4L23.2 21.2Z', ink: fill },
      { kind: 'circle', cx: 30.6, cy: 21.4, r: 8.4, ink: fill },
    ],
    front: [],
    frontPivot: { x: 31, y: 22 },
    eyes: { x: 30.8, y: 20.6 },
    eyeGap: 3.9,
  }),
};

/** A small transform of the ears or beak, applied around the part's pivot. */
export interface PartPose {
  x: number;
  y: number;
  /** Degrees. */
  rotate: number;
  scale: number;
}

const REST: PartPose = { x: 0, y: 0, rotate: 0, scale: 1 };

/** Ears perk when the bot needs approval and droop while it sleeps. */
export const BACK_POSE: Record<AvatarMood, PartPose> = {
  idle: REST,
  thinking: REST,
  approval: { x: 0, y: -1, rotate: 0, scale: 1.06 },
  sleeping: { x: 0, y: 1.2, rotate: 0, scale: 0.93 },
  error: { x: 0, y: 0.6, rotate: 0, scale: 0.97 },
  success: { x: 0, y: -0.6, rotate: 0, scale: 1.04 },
};

/** Beaks and rostra lift a little on success and dip while asleep. */
export const FRONT_POSE: Record<AvatarMood, PartPose> = {
  idle: REST,
  thinking: REST,
  approval: { x: 0, y: -0.3, rotate: 0, scale: 1 },
  sleeping: { x: 0, y: 0.6, rotate: 0, scale: 1 },
  error: { x: 0, y: 0.3, rotate: 0, scale: 1 },
  success: { x: 0, y: -0.8, rotate: 0, scale: 1.02 },
};

export function isRestPose(pose: PartPose): boolean {
  return pose.x === 0 && pose.y === 0 && pose.rotate === 0 && pose.scale === 1;
}

/** The pose as an SVG transform attribute around `pivot`, in viewBox units. */
export function poseTransform(pose: PartPose, pivot: Point): string | undefined {
  if (isRestPose(pose)) return undefined;
  const { x, y } = pivot;
  return `translate(${fmt(pose.x + x)} ${fmt(pose.y + y)}) rotate(${fmt(pose.rotate)}) scale(${fmt(pose.scale)}) translate(${fmt(-x)} ${fmt(-y)})`;
}

const quad = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number) =>
  `M${fmt(x1)} ${fmt(y1)}Q${fmt(cx)} ${fmt(cy)} ${fmt(x2)} ${fmt(y2)}`;

/**
 * Eye strokes for a mood, as [left, right] path data. Every mood uses the same `M Q` command
 * structure so CSS can interpolate between them.
 */
export function eyePaths(mood: AvatarMood, anchor: Point, gap: number = EYE_HALF_GAP): [string, string] {
  const eye = (side: -1 | 1): string => {
    const x = anchor.x + side * gap;
    const y = anchor.y;
    switch (mood) {
      case 'idle':
        return quad(x, y - 2.5, x, y, x, y + 2.5);
      case 'thinking':
        return quad(x, y - 2.1, x, y, x, y + 2.1);
      case 'approval':
        return quad(x, y - 3.8, x, y - 0.3, x, y + 3.2);
      case 'sleeping':
        return quad(x - 2.6, y + 1 - side * 0.5, x, y + 1.3, x + 2.6, y + 1 + side * 0.5);
      case 'error':
        return quad(x + side * 1.4, y + 2.3, x, y, x - side * 1.4, y - 2.3);
      case 'success':
        return quad(x - 2.6, y + 1.3, x, y - 3.1, x + 2.6, y + 1.3);
    }
  };
  return [eye(-1), eye(1)];
}

/** Resolves a species name, or a legacy shape name, to a species. */
export function toSpecies(value: string): AvatarSpecies | undefined {
  if ((AVATAR_SPECIES as readonly string[]).includes(value)) return value as AvatarSpecies;
  if ((LEGACY_AVATAR_SHAPES as readonly string[]).includes(value)) return LEGACY_SHAPE_SPECIES[value as LegacyAvatarShape];
  return undefined;
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
 * Parses a `bot.avatar` value of the form "species:color". Legacy shape names map to a species;
 * any missing or unknown part falls back to a deterministic pick from `seed` (the bot id).
 */
export function parseAvatar(value: string | undefined, seed: string): AvatarSpec {
  const [rawSpecies = '', rawColor = ''] = (value ?? '').trim().toLowerCase().split(':');
  const hash = hashSeed(seed);
  const species = toSpecies(rawSpecies) ?? AVATAR_SPECIES[hash % AVATAR_SPECIES.length]!;
  const color = isColor(rawColor) ? rawColor : AVATAR_COLOR_NAMES[(hash >>> 8) % AVATAR_COLOR_NAMES.length]!;
  return { species, color, shape: species };
}

/** Serializes an avatar spec back to its `bot.avatar` form. */
export function formatAvatar(spec: Pick<AvatarSpec, 'species' | 'color'>): string {
  return `${spec.species}:${spec.color}`;
}
