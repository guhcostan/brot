import type { ComputerInput } from '@brot/protocol';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Maps a pointer position on the displayed screen to desktop pixels, clamped to the screen. */
export function toScreenPoint(clientX: number, clientY: number, box: Box, width: number, height: number): { x: number; y: number } {
  const clamp = (value: number, max: number) => Math.min(max - 1, Math.max(0, Math.round(value)));
  const x = box.width > 0 ? ((clientX - box.left) / box.width) * width : 0;
  const y = box.height > 0 ? ((clientY - box.top) / box.height) * height : 0;
  return { x: clamp(x, width), y: clamp(y, height) };
}

/** Wheel distance to xdotool scroll steps: about one step per 40px, at most 20 either way, never 0. */
export function wheelToDy(deltaY: number): number {
  if (deltaY === 0) return 0;
  const steps = Math.max(1, Math.min(20, Math.round(Math.abs(deltaY) / 40)));
  return Math.sign(deltaY) * steps;
}

const KEY_NAMES: Record<string, string> = {
  Enter: 'Return',
  Backspace: 'BackSpace',
  Tab: 'Tab',
  Escape: 'Escape',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'Prior',
  PageDown: 'Next',
  Insert: 'Insert',
};

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * A keydown on the screen as desktop input: printable text types literally, named keys and shortcuts
 * become xdotool key names (`Return`, `ctrl+l`). Cmd counts as Ctrl, since the desktop is Linux.
 * Returns null for keys the desktop cannot take (lone modifiers, dead keys).
 */
export function keyToInput(event: KeyLike): ComputerInput | null {
  const { key } = event;
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'Dead' || key === 'CapsLock' || key === 'Unidentified') {
    return null;
  }
  const modifiers = [event.ctrlKey || event.metaKey ? 'ctrl' : '', event.altKey ? 'alt' : ''].filter(Boolean);
  const named = KEY_NAMES[key] ?? (/^F\d{1,2}$/.test(key) ? key : undefined);
  if (named) {
    const combo = [...modifiers, event.shiftKey && modifiers.length > 0 ? 'shift' : '', named].filter(Boolean).join('+');
    return { type: 'key', key: combo };
  }
  if (key.length === 1) {
    if (modifiers.length === 0) return { type: 'type', text: key };
    if (/^[A-Za-z0-9]$/.test(key)) return { type: 'key', key: [...modifiers, key.toLowerCase()].join('+') };
    return null;
  }
  return null;
}
