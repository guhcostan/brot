import { describe, expect, it } from 'vitest';
import {
  AVATAR_MOODS,
  AVATAR_SPECIES,
  BACK_POSE,
  FRONT_POSE,
  LEGACY_AVATAR_SHAPES,
  LEGACY_SHAPE_SPECIES,
  SPECIES_GEOMETRY,
  eyePaths,
  formatAvatar,
  hashSeed,
  parseAvatar,
  poseTransform,
  toSpecies,
  type AvatarPart,
} from './avatar';
import { AVATAR_COLOR_NAMES } from './tokens';

describe('parseAvatar', () => {
  it('parses "species:color"', () => {
    expect(parseAvatar('capivara:violet', 'bot_1')).toEqual({ species: 'capivara', color: 'violet', shape: 'capivara' });
    expect(parseAvatar('  Onca:White ', 'bot_1')).toMatchObject({ species: 'onca', color: 'white' });
  });

  it('round-trips through formatAvatar', () => {
    for (const species of AVATAR_SPECIES) {
      for (const color of AVATAR_COLOR_NAMES) {
        expect(parseAvatar(formatAvatar({ species, color }), 'seed')).toEqual({ species, color, shape: species });
      }
    }
  });

  it('maps every legacy shape to its species and keeps the color', () => {
    expect(LEGACY_SHAPE_SPECIES).toEqual({
      circle: 'capivara',
      squircle: 'capivara',
      tilted: 'onca',
      cloud: 'preguica',
      triangle: 'lobo',
      blob: 'mico',
      drop: 'boto',
    });
    for (const shape of LEGACY_AVATAR_SHAPES) {
      expect(parseAvatar(`${shape}:teal`, 'bot_x')).toMatchObject({ species: LEGACY_SHAPE_SPECIES[shape], color: 'teal' });
      expect(toSpecies(shape)).toBe(LEGACY_SHAPE_SPECIES[shape]);
    }
    expect(parseAvatar('squircle:black', 'bot_capy')).toMatchObject({ species: 'capivara', color: 'black' });
  });

  it('falls back to a deterministic pick from the seed for missing or unknown values', () => {
    const fallback = parseAvatar(undefined, 'bot_lua');
    expect(AVATAR_SPECIES).toContain(fallback.species);
    expect(AVATAR_COLOR_NAMES).toContain(fallback.color);
    expect(parseAvatar('', 'bot_lua')).toEqual(fallback);
    expect(parseAvatar('legacy-animal', 'bot_lua')).toEqual(fallback);
    expect(parseAvatar('hexagon:neon', 'bot_lua')).toEqual(fallback);
    expect(parseAvatar(undefined, 'bot_lua')).toEqual(fallback);
  });

  it('keeps whichever half is valid', () => {
    const fallback = parseAvatar(undefined, 'bot_x');
    expect(parseAvatar('mico:neon', 'bot_x')).toMatchObject({ species: 'mico', color: fallback.color });
    expect(parseAvatar('blob:neon', 'bot_x')).toMatchObject({ species: 'mico', color: fallback.color });
    expect(parseAvatar('hexagon:amber', 'bot_x')).toMatchObject({ species: fallback.species, color: 'amber' });
  });

  it('spreads different seeds across species and colors', () => {
    const picks = new Set(Array.from({ length: 64 }, (_, i) => formatAvatar(parseAvatar(undefined, `bot_${i}`))));
    expect(picks.size).toBeGreaterThan(30);
    const species = new Set(Array.from({ length: 200 }, (_, i) => parseAvatar(undefined, `bot_${i}`).species));
    expect(species.size).toBe(AVATAR_SPECIES.length);
  });

  it('hashes with stable 32-bit FNV-1a', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
    expect(hashSeed('a')).toBe(0xe40c292c);
  });
});

describe('species geometry', () => {
  it('draws every species inside a padded 40-unit box, with a head and eyes on the face', () => {
    for (const species of AVATAR_SPECIES) {
      const g = SPECIES_GEOMETRY[species];
      expect(g.head.length, species).toBeGreaterThan(0);
      expect(g.head.some((part) => part.ink === 'fill'), species).toBe(true);
      expect(g.eyes.x - g.eyeGap, species).toBeGreaterThan(2);
      expect(g.eyes.x + g.eyeGap, species).toBeLessThan(38);
      expect(g.eyes.y, species).toBeGreaterThan(8);
      expect(g.eyes.y, species).toBeLessThan(32);
      for (const part of [...g.back, ...g.head, ...g.front]) {
        const numbers = part.kind === 'path' ? (part.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) : [];
        for (const n of numbers) {
          expect(n, `${species} ${part.kind}`).toBeGreaterThanOrEqual(-2);
          expect(n, `${species} ${part.kind}`).toBeLessThanOrEqual(42);
        }
      }
    }
  });

  it('uses only path commands that mirror and morph safely', () => {
    for (const species of AVATAR_SPECIES) {
      const g = SPECIES_GEOMETRY[species];
      for (const part of [...g.back, ...g.head, ...g.front]) {
        if (part.kind === 'path') expect(part.d, species).toMatch(/^M[-\d. MLCQZ]+$/);
      }
    }
  });

  it('turns profile heads to face left, so stacked avatars never hide a beak', () => {
    const xs = (part: AvatarPart): number[] => {
      switch (part.kind) {
        case 'circle':
          return [part.cx - part.r, part.cx + part.r];
        case 'ellipse':
          return [part.cx - Math.max(part.rx, part.ry), part.cx + Math.max(part.rx, part.ry)];
        case 'rect':
          return [part.x, part.x + part.width];
        case 'path':
          return [...part.d.matchAll(/(-?\d+(?:\.\d+)?) -?\d/g)].map((m) => Number(m[1]));
      }
    };
    for (const species of ['tucano', 'arara', 'tamandua', 'boto', 'jabuti'] as const) {
      const g = SPECIES_GEOMETRY[species];
      const all = [...g.back, ...g.head, ...g.front].flatMap(xs);
      const left = 20 - Math.min(...all);
      const right = Math.max(...all) - 20;
      expect(left, species).toBeGreaterThan(right);
    }
  });
});

describe('mood poses', () => {
  it('rests while idle and perks or droops otherwise', () => {
    expect(poseTransform(BACK_POSE.idle, { x: 20, y: 14 })).toBeUndefined();
    expect(BACK_POSE.approval.y).toBeLessThan(0);
    expect(BACK_POSE.sleeping.y).toBeGreaterThan(0);
    for (const mood of AVATAR_MOODS) {
      for (const pose of [BACK_POSE[mood], FRONT_POSE[mood]]) {
        expect(Math.abs(pose.x) + Math.abs(pose.y)).toBeLessThanOrEqual(1.5);
        expect(Math.abs(pose.scale - 1)).toBeLessThanOrEqual(0.08);
      }
    }
  });

  it('builds an SVG transform around the pivot', () => {
    expect(poseTransform({ x: 0, y: -1, rotate: 0, scale: 1.06 }, { x: 20, y: 14 })).toBe(
      'translate(20 13) rotate(0) scale(1.06) translate(-20 -14)',
    );
  });
});

describe('eyePaths', () => {
  it('uses one M/Q structure for every mood and species so strokes can morph', () => {
    for (const species of AVATAR_SPECIES) {
      const g = SPECIES_GEOMETRY[species];
      for (const mood of AVATAR_MOODS) {
        for (const d of eyePaths(mood, g.eyes, g.eyeGap)) {
          expect(d).toMatch(/^M[\d.-]+ [\d.-]+Q[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+$/);
        }
      }
    }
  });

  it('mirrors the eyes around the anchor', () => {
    const [left, right] = eyePaths('idle', { x: 20, y: 18 });
    expect(left).toBe('M15 15.5Q15 18 15 20.5');
    expect(right).toBe('M25 15.5Q25 18 25 20.5');
    expect(eyePaths('idle', { x: 20, y: 18 }, 4)[0]).toBe('M16 15.5Q16 18 16 20.5');
  });

  it('closes the eyes with a sleepy droop toward the outside', () => {
    const [left, right] = eyePaths('sleeping', { x: 20, y: 18 });
    expect(left).toBe('M12.4 19.5Q15 19.3 17.6 18.5');
    expect(right).toBe('M22.4 18.5Q25 19.3 27.6 19.5');
  });
});
