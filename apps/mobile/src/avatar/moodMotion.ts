import type { AvatarMood } from '@brot/ui/avatar';

/**
 * Per-mood motion from DESIGN.md section 2, matching the web BotAvatar's timings. Units: ms for
 * time, viewBox units (of 40) for eye offsets, fractions of the avatar size for body movement.
 */
export interface MoodMotion {
  /** Gap between blinks; absent means the eyes do not blink. */
  blink?: [number, number];
  /** Occasional slow glance: gap range between glances. */
  glance?: [number, number];
  /** Continuous side-to-side scan, one direction per `scanMs`. */
  scanMs?: number;
  /** Breathing loop: full period and peak scale. */
  breathe?: { periodMs: number; scale: number };
  /** Gentle bob every `everyMs`. */
  bob?: { everyMs: number; lift: number };
  /** Eye offset held while in this mood (e.g. looking toward the approval card). */
  look?: { x: number; y: number };
  /** One-shot entrance reaction. */
  enter?: 'shake' | 'hop';
}

export const BLINK_MS = 130;
export const MORPH_MS = 160;
export const SUCCESS_HOLD_MS = 1600;
export const GLANCE_REACH = 1.6;

export const MOOD_MOTION: Record<AvatarMood, MoodMotion> = {
  idle: { blink: [3000, 7000], glance: [6000, 12000], breathe: { periodMs: 4000, scale: 1.02 } },
  thinking: { blink: [6000, 12000], scanMs: 600, breathe: { periodMs: 4000, scale: 1.02 } },
  approval: { blink: [3000, 7000], bob: { everyMs: 3200, lift: 0.04 }, look: { x: 0.6, y: 0.8 } },
  sleeping: { breathe: { periodMs: 6000, scale: 1.02 } },
  error: { enter: 'shake' },
  success: { enter: 'hop' },
};
