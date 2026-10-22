import { describe, expect, it } from 'vitest';
import {
  BROWSER_VIEWPORT_HEIGHT,
  BROWSER_VIEWPORT_WIDTH,
  browserClick,
  browserKey,
  browserScroll,
  isDoubleClick,
  viewportPoint,
} from './browserLive';

const box = { left: 100, top: 50, width: 640, height: 400 };

describe('viewportPoint', () => {
  it('scales the displayed frame to the 1280x800 browser viewport', () => {
    expect(BROWSER_VIEWPORT_WIDTH).toBe(1280);
    expect(BROWSER_VIEWPORT_HEIGHT).toBe(800);
    expect(viewportPoint(100, 50, box)).toEqual({ x: 0, y: 0 });
    expect(viewportPoint(420, 250, box)).toEqual({ x: 640, y: 400 });
    expect(viewportPoint(740, 450, box)).toEqual({ x: 1279, y: 799 });
  });

  it('clamps points outside the frame', () => {
    expect(viewportPoint(-40, -20, box)).toEqual({ x: 0, y: 0 });
    expect(viewportPoint(2000, 2000, box)).toEqual({ x: 1279, y: 799 });
  });

  it('falls back to the origin for a zero-size frame', () => {
    expect(viewportPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('isDoubleClick', () => {
  it('accepts a second click close in time and space', () => {
    expect(isDoubleClick({ at: 1000, x: 300, y: 200 }, 303, 202, 1200)).toBe(true);
    expect(isDoubleClick(undefined, 300, 200, 1000)).toBe(false);
    expect(isDoubleClick({ at: 1000, x: 300, y: 200 }, 320, 200, 1200)).toBe(false);
    expect(isDoubleClick({ at: 1000, x: 300, y: 200 }, 301, 200, 1600)).toBe(false);
  });
});

describe('input builders', () => {
  it('builds clicks, scrolls and keys for the browser', () => {
    expect(browserClick({ x: 10, y: 20 }, false)).toEqual({ type: 'click', x: 10, y: 20, button: 'left', double: false });
    expect(browserClick({ x: 10, y: 20 }, true)).toMatchObject({ double: true });
    expect(browserScroll({ x: 10, y: 20 }, 200)).toEqual({ type: 'scroll', x: 10, y: 20, dy: 5 });
    expect(browserScroll({ x: 10, y: 20 }, 0)).toBeNull();
    expect(browserKey('Enter')).toEqual({ type: 'key', key: 'Enter' });
    expect(browserKey('Backspace')).toEqual({ type: 'key', key: 'Backspace' });
  });
});
