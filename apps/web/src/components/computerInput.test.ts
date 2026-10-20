import { describe, expect, it } from 'vitest';
import { ComputerInput } from '@brot/protocol';
import { keyToInput, toScreenPoint, wheelToDy, type KeyLike } from './computerInput';

const key = (value: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('toScreenPoint', () => {
  const box = { left: 100, top: 50, width: 640, height: 400 };

  it('scales the displayed size to the desktop size', () => {
    expect(toScreenPoint(100, 50, box, 1280, 800)).toEqual({ x: 0, y: 0 });
    expect(toScreenPoint(420, 250, box, 1280, 800)).toEqual({ x: 640, y: 400 });
  });

  it('clamps points outside the image', () => {
    expect(toScreenPoint(2000, -10, box, 1280, 800)).toEqual({ x: 1279, y: 0 });
  });
});

describe('wheelToDy', () => {
  it('keeps the sign, rounds to steps and caps at 20', () => {
    expect(wheelToDy(0)).toBe(0);
    expect(wheelToDy(5)).toBe(1);
    expect(wheelToDy(-120)).toBe(-3);
    expect(wheelToDy(10_000)).toBe(20);
  });
});

describe('keyToInput', () => {
  it('types printable characters literally', () => {
    expect(keyToInput(key('a'))).toEqual({ type: 'type', text: 'a' });
    expect(keyToInput(key('ç'))).toEqual({ type: 'type', text: 'ç' });
  });

  it('names special keys the xdotool way', () => {
    expect(keyToInput(key('Enter'))).toEqual({ type: 'key', key: 'Return' });
    expect(keyToInput(key('Backspace'))).toEqual({ type: 'key', key: 'BackSpace' });
    expect(keyToInput(key('ArrowLeft'))).toEqual({ type: 'key', key: 'Left' });
  });

  it('turns shortcuts into combos, with Cmd as Ctrl', () => {
    expect(keyToInput(key('l', { metaKey: true }))).toEqual({ type: 'key', key: 'ctrl+l' });
    expect(keyToInput(key('Tab', { ctrlKey: true, shiftKey: true }))).toEqual({ type: 'key', key: 'ctrl+shift+Tab' });
  });

  it('ignores lone modifiers', () => {
    expect(keyToInput(key('Shift'))).toBeNull();
    expect(keyToInput(key('Meta', { metaKey: true }))).toBeNull();
  });

  it('only produces input the protocol accepts', () => {
    for (const value of ['a', 'Enter', 'F5', 'PageDown']) {
      const input = keyToInput(key(value, { ctrlKey: value === 'a' }));
      expect(() => ComputerInput.parse(input)).not.toThrow();
    }
  });
});
