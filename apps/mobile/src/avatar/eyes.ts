import { eyePaths, type AvatarMood } from '@brot/ui/avatar';

/** One eye stroke as the numbers of `M x1 y1 Q cx cy x2 y2`. */
export type EyeQuad = [number, number, number, number, number, number];

/** Both eyes, left then right, flattened so a shared value can hold them. */
export type EyePair = [...EyeQuad, ...EyeQuad];

export function parseQuad(d: string): EyeQuad {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!/^M[^MQ]+Q[^MQ]+$/.test(d) || numbers.length !== 6) throw new Error(`Not a single quadratic stroke: ${d}`);
  return numbers as EyeQuad;
}

/** The eye strokes for a mood, from the same geometry the web avatar draws. */
export function eyePair(mood: AvatarMood, anchor: { x: number; y: number }): EyePair {
  const [left, right] = eyePaths(mood, anchor);
  return [...parseQuad(left), ...parseQuad(right)];
}

/*
 * The helpers below run on the UI thread inside Reanimated worklets, hence the directives.
 */

export function mixPair(from: readonly number[], to: readonly number[], t: number): number[] {
  'worklet';
  const out: number[] = [];
  for (let i = 0; i < to.length; i++) {
    const a = from[i] ?? to[i]!;
    out.push(a + (to[i]! - a) * t);
  }
  return out;
}

/**
 * Applies a blink (vertical squash toward `anchorY`, 1 = open) and a glance offset to both eyes.
 * Squashing the stroke itself keeps the blink inside the path, so no SVG transform is animated.
 */
export function posePair(pair: readonly number[], anchorY: number, openness: number, dx: number, dy: number): number[] {
  'worklet';
  const out: number[] = [];
  for (let i = 0; i < pair.length; i++) {
    const value = pair[i]!;
    out.push(i % 2 === 0 ? value + dx : anchorY + (value - anchorY) * openness + dy);
  }
  return out;
}

function fmt(n: number): string {
  'worklet';
  return String(Math.round(n * 100) / 100);
}

/** Path data for the eye at `offset` (0 = left, 6 = right). */
export function quadPath(pair: readonly number[], offset: number): string {
  'worklet';
  const p = (i: number) => fmt(pair[offset + i] ?? 0);
  return `M${p(0)} ${p(1)}Q${p(2)} ${p(3)} ${p(4)} ${p(5)}`;
}
