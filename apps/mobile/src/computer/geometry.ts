import { DESKTOP_HEIGHT, DESKTOP_WIDTH } from '@brot/protocol';

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Pinch zoom applied around the view's center: scale, then translate, in view points. */
export interface Zoom {
  scale: number;
  tx: number;
  ty: number;
}

export const NO_ZOOM: Zoom = { scale: 1, tx: 0, ty: 0 };
export const MAX_ZOOM = 4;
export const DESKTOP: Size = { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT };

/** Where an image of `content` size sits when fitted ("contain") inside `view`. */
export function fitRect(view: Size, content: Size = DESKTOP): Rect {
  if (view.width <= 0 || view.height <= 0 || content.width <= 0 || content.height <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(view.width / content.width, view.height / content.height);
  const width = content.width * scale;
  const height = content.height * scale;
  return { x: (view.width - width) / 2, y: (view.height - height) / 2, width, height };
}

/** Clamps the scale to 1..MAX_ZOOM and the pan so the zoomed screen always covers its unzoomed area. */
export function clampZoom(zoom: Zoom, view: Size, content: Size = DESKTOP): Zoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale));
  const fit = fitRect(view, content);
  const limitX = (fit.width * (scale - 1)) / 2;
  const limitY = (fit.height * (scale - 1)) / 2;
  return {
    scale,
    tx: scale === 1 ? 0 : Math.min(limitX, Math.max(-limitX, zoom.tx)),
    ty: scale === 1 ? 0 : Math.min(limitY, Math.max(-limitY, zoom.ty)),
  };
}

/**
 * Maps a tap in view points to a desktop pixel. Undoes the zoom (scale around the view center, then
 * translate), then the "contain" fit. Returns null for a tap on the letterbox outside the screen.
 */
export function viewToDesktop(point: { x: number; y: number }, view: Size, zoom: Zoom = NO_ZOOM, content: Size = DESKTOP): { x: number; y: number } | null {
  const fit = fitRect(view, content);
  if (fit.width === 0) return null;
  const cx = view.width / 2;
  const cy = view.height / 2;
  const ux = cx + (point.x - cx - zoom.tx) / zoom.scale;
  const uy = cy + (point.y - cy - zoom.ty) / zoom.scale;
  const rx = (ux - fit.x) / fit.width;
  const ry = (uy - fit.y) / fit.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
  return {
    x: Math.min(content.width - 1, Math.max(0, Math.round(rx * content.width))),
    y: Math.min(content.height - 1, Math.max(0, Math.round(ry * content.height))),
  };
}

/** The zoom after a pinch that started at `start`, now at `ratio` of its starting finger distance, around `focus`. */
export function pinchZoom(start: Zoom, ratio: number, focus: { x: number; y: number }, view: Size): Zoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, start.scale * ratio));
  const k = scale / start.scale;
  const cx = view.width / 2;
  const cy = view.height / 2;
  // Keep the content point under the fingers' focus in place while scaling.
  const tx = focus.x - cx - (focus.x - cx - start.tx) * k;
  const ty = focus.y - cy - (focus.y - cy - start.ty) * k;
  return clampZoom({ scale, tx, ty }, view);
}
