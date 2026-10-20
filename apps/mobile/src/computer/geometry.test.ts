import { describe, expect, it } from 'vitest';
import { clampZoom, fitRect, NO_ZOOM, pinchZoom, viewToDesktop } from './geometry';

const view = { width: 320, height: 200 };

describe('screen geometry', () => {
  it('fits the 1280x800 desktop inside the view', () => {
    expect(fitRect(view)).toEqual({ x: 0, y: 0, width: 320, height: 200 });
    expect(fitRect({ width: 320, height: 400 })).toEqual({ x: 0, y: 100, width: 320, height: 200 });
  });

  it('maps taps to desktop pixels and ignores the letterbox', () => {
    expect(viewToDesktop({ x: 160, y: 100 }, view)).toEqual({ x: 640, y: 400 });
    expect(viewToDesktop({ x: 0, y: 0 }, view)).toEqual({ x: 0, y: 0 });
    expect(viewToDesktop({ x: 320, y: 200 }, view)).toEqual({ x: 1279, y: 799 });
    expect(viewToDesktop({ x: 160, y: 50 }, { width: 320, height: 400 })).toBeNull();
  });

  it('undoes zoom and pan before mapping', () => {
    const zoom = { scale: 2, tx: 0, ty: 0 };
    expect(viewToDesktop({ x: 160, y: 100 }, view, zoom)).toEqual({ x: 640, y: 400 });
    expect(viewToDesktop({ x: 0, y: 0 }, view, zoom)).toEqual({ x: 320, y: 200 });
    expect(viewToDesktop({ x: 0, y: 0 }, view, { scale: 2, tx: 160, ty: 100 })).toEqual({ x: 0, y: 0 });
  });

  it('keeps the point under the fingers while pinching, within bounds', () => {
    const focus = { x: 80, y: 50 };
    const before = viewToDesktop(focus, view, NO_ZOOM);
    const zoomed = pinchZoom(NO_ZOOM, 2, focus, view);
    expect(zoomed.scale).toBe(2);
    expect(viewToDesktop(focus, view, zoomed)).toEqual(before);
    expect(pinchZoom(NO_ZOOM, 0.5, focus, view)).toEqual(NO_ZOOM);
    expect(pinchZoom(NO_ZOOM, 10, focus, view).scale).toBe(4);
  });

  it('never pans the zoomed screen off its own area', () => {
    expect(clampZoom({ scale: 2, tx: 999, ty: -999 }, view)).toEqual({ scale: 2, tx: 160, ty: -100 });
    expect(clampZoom({ scale: 1, tx: 30, ty: 30 }, view)).toEqual(NO_ZOOM);
  });
});
