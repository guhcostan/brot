import type { ComputerInput } from '@brot/protocol';
import { toScreenPoint, wheelToDy, type Box } from './computerInput';

/** The host browser's fixed viewport, the same one the server screenshots and its own input uses. */
export const BROWSER_VIEWPORT_WIDTH = 1280;
export const BROWSER_VIEWPORT_HEIGHT = 800;

/** How often the live view asks for a new JPEG while it is open and the tab is visible. */
export const BROWSER_FRAME_MS = 1500;

/** A second click within this many milliseconds and pixels of the first counts as a double click. */
export const DOUBLE_CLICK_MS = 400;
export const DOUBLE_CLICK_DISTANCE = 8;

/** Maps a pointer position on the displayed frame to the browser viewport, clamped to it. */
export function viewportPoint(clientX: number, clientY: number, box: Box): { x: number; y: number } {
  return toScreenPoint(clientX, clientY, box, BROWSER_VIEWPORT_WIDTH, BROWSER_VIEWPORT_HEIGHT);
}

export interface ClickStamp {
  at: number;
  x: number;
  y: number;
}

/** Whether this click is the second half of a double click on the page. */
export function isDoubleClick(previous: ClickStamp | undefined, x: number, y: number, now: number): boolean {
  if (previous === undefined) return false;
  return now - previous.at <= DOUBLE_CLICK_MS && Math.hypot(x - previous.x, y - previous.y) <= DOUBLE_CLICK_DISTANCE;
}

/** A left click at a viewport point, single or double. */
export function browserClick(point: { x: number; y: number }, double: boolean): ComputerInput {
  return { type: 'click', x: point.x, y: point.y, button: 'left', double };
}

/** A wheel event at a viewport point, or null when the accumulated delta is too small to move. */
export function browserScroll(point: { x: number; y: number }, deltaY: number): ComputerInput | null {
  const dy = wheelToDy(deltaY);
  return dy === 0 ? null : { type: 'scroll', x: point.x, y: point.y, dy };
}

/** One named key press for the controls row. */
export function browserKey(key: 'Enter' | 'Escape' | 'Tab' | 'Backspace'): ComputerInput {
  return { type: 'key', key };
}
