import { AVATAR_MOODS, AVATAR_SPECIES, SPECIES_GEOMETRY, eyePaths } from '@brot/ui/avatar';
import { describe, expect, it } from 'vitest';
import { eyePair, mixPair, parseQuad, posePair, quadPath } from './eyes';

describe('eye geometry', () => {
  it('round-trips every species’ and mood’s eye paths from @brot/ui', () => {
    for (const species of AVATAR_SPECIES) {
      const { eyes, eyeGap } = SPECIES_GEOMETRY[species];
      for (const mood of AVATAR_MOODS) {
        const pair = eyePair(mood, eyes, eyeGap);
        expect([quadPath(pair, 0), quadPath(pair, 6)]).toEqual(eyePaths(mood, eyes, eyeGap));
      }
    }
  });

  it('rejects anything but a single quadratic stroke', () => {
    expect(() => parseQuad('M0 0L1 1')).toThrow();
    expect(() => parseQuad('M0 0Q1 1 2 2Q3 3 4 4')).toThrow();
  });

  it('interpolates between moods', () => {
    const anchor = { x: 20, y: 17.5 };
    const idle = eyePair('idle', anchor);
    const sleeping = eyePair('sleeping', anchor);
    expect(mixPair(idle, sleeping, 0)).toEqual(idle);
    expect(mixPair(idle, sleeping, 1)).toEqual(sleeping);
    expect(mixPair(idle, sleeping, 0.5)[1]).toBeCloseTo(((idle[1] ?? 0) + (sleeping[1] ?? 0)) / 2);
  });

  it('blinks by squashing toward the anchor and glances by offsetting', () => {
    const anchor = { x: 20, y: 17.5 };
    const idle = eyePair('idle', anchor);
    const closed = posePair(idle, anchor.y, 0, 0, 0);
    for (let i = 1; i < closed.length; i += 2) expect(closed[i]).toBeCloseTo(anchor.y);
    const glance = posePair(idle, anchor.y, 1, 1.5, 0);
    expect(glance[0]).toBeCloseTo((idle[0] ?? 0) + 1.5);
    expect(glance[1]).toBeCloseTo(idle[1] ?? 0);
  });
});
