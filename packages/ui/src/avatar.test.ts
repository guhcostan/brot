import { describe, expect, it } from 'vitest';
import { AVATAR_MOODS, AVATAR_SHAPES, SHAPE_GEOMETRY, eyePaths, formatAvatar, hashSeed, parseAvatar } from './avatar';
import { AVATAR_COLOR_NAMES } from './tokens';

describe('parseAvatar', () => {
  it('parses "shape:color"', () => {
    expect(parseAvatar('cloud:teal', 'bot_1')).toEqual({ shape: 'cloud', color: 'teal' });
    expect(parseAvatar('  Drop:Pink ', 'bot_1')).toEqual({ shape: 'drop', color: 'pink' });
  });

  it('round-trips through formatAvatar', () => {
    for (const shape of AVATAR_SHAPES) {
      for (const color of AVATAR_COLOR_NAMES) {
        expect(parseAvatar(formatAvatar({ shape, color }), 'seed')).toEqual({ shape, color });
      }
    }
  });

  it('falls back to a deterministic pick from the seed for missing or unknown values', () => {
    const fallback = parseAvatar(undefined, 'bot_lua');
    expect(AVATAR_SHAPES).toContain(fallback.shape);
    expect(AVATAR_COLOR_NAMES).toContain(fallback.color);
    expect(parseAvatar('', 'bot_lua')).toEqual(fallback);
    expect(parseAvatar('legacy-animal', 'bot_lua')).toEqual(fallback);
    expect(parseAvatar('hexagon:neon', 'bot_lua')).toEqual(fallback);
    expect(parseAvatar(undefined, 'bot_lua')).toEqual(fallback);
  });

  it('keeps whichever half is valid', () => {
    const fallback = parseAvatar(undefined, 'bot_x');
    expect(parseAvatar('blob:neon', 'bot_x')).toEqual({ shape: 'blob', color: fallback.color });
    expect(parseAvatar('hexagon:amber', 'bot_x')).toEqual({ shape: fallback.shape, color: 'amber' });
  });

  it('spreads different seeds across shapes and colors', () => {
    const picks = new Set(Array.from({ length: 64 }, (_, i) => formatAvatar(parseAvatar(undefined, `bot_${i}`))));
    expect(picks.size).toBeGreaterThan(30);
  });

  it('hashes with stable 32-bit FNV-1a', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('a')).toBe(0xe40c292c);
  });
});

describe('eyePaths', () => {
  it('uses one M/Q structure for every mood and shape so strokes can morph', () => {
    for (const shape of AVATAR_SHAPES) {
      for (const mood of AVATAR_MOODS) {
        for (const d of eyePaths(mood, SHAPE_GEOMETRY[shape].eyes)) {
          expect(d).toMatch(/^M[\d.-]+ [\d.-]+Q[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
        }
      }
    }
  });

  it('mirrors the eyes around the anchor', () => {
    const [left, right] = eyePaths('idle', { x: 20, y: 18 });
    expect(left).toBe('M15 15.5Q15 18 15 20.5');
    expect(right).toBe('M25 15.5Q25 18 25 20.5');
  });
});
