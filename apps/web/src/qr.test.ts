import { describe, expect, it } from 'vitest';
import { encodeQr, qrPath } from './qr';

const finderAt = (grid: boolean[][], x0: number, y0: number) => {
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (grid[y0 + y]![x0 + x] !== (ring !== 2)) return false;
    }
  }
  return true;
};

describe('encodeQr', () => {
  it('picks the smallest version that fits, at level M', () => {
    expect(encodeQr('hello').length).toBe(21);
    expect(encodeQr('x'.repeat(60)).length).toBe(33);
    expect(encodeQr('x'.repeat(200)).length).toBe(57);
  });

  it('draws the three finder patterns and the timing lines', () => {
    const grid = encodeQr('brot://pair?host=127.0.0.1&port=8799&token=abc&code=123456');
    const size = grid.length;
    expect(finderAt(grid, 0, 0)).toBe(true);
    expect(finderAt(grid, size - 7, 0)).toBe(true);
    expect(finderAt(grid, 0, size - 7)).toBe(true);
    for (let i = 8; i < size - 8; i += 1) {
      expect(grid[6]![i]).toBe(i % 2 === 0);
      expect(grid[i]![6]).toBe(i % 2 === 0);
    }
    expect(grid[size - 8]![8]).toBe(true);
  });

  it('is deterministic', () => {
    expect(qrPath(encodeQr('same'))).toBe(qrPath(encodeQr('same')));
  });

  it('refuses text longer than version 10 holds', () => {
    expect(() => encodeQr('x'.repeat(300))).toThrow();
  });
});
