import type { ComputerInput } from '@brot/protocol';

/**
 * argv builders for everything the server runs inside a bot desktop. Each function returns an argv array
 * (plus env where needed). Nothing is joined into a shell string, and user text is always a single argument.
 */

export const DESKTOP_ENV = { DISPLAY: ':1' } as const;
export const JPEG_QUALITY = 70;

export function screenshotArgv(): string[] {
  return ['import', '-window', 'root', '-quality', String(JPEG_QUALITY), 'jpeg:-'];
}

export const desktopStartArgv = (): string[] => ['brot-desktop-start'];

export const SCROLL_UP = 4;
export const SCROLL_DOWN = 5;
const BUTTONS = { left: 1, middle: 2, right: 3 } as const;

/** The xdotool commands for one input event. A scroll with dy 0 only moves the pointer. */
export function inputArgv(input: ComputerInput): string[][] {
  switch (input.type) {
    case 'move':
      return [['xdotool', 'mousemove', '--sync', String(input.x), String(input.y)]];
    case 'click':
      return [
        [
          'xdotool',
          'mousemove',
          '--sync',
          String(input.x),
          String(input.y),
          'click',
          '--repeat',
          input.double ? '2' : '1',
          '--delay',
          '80',
          String(BUTTONS[input.button]),
        ],
      ];
    case 'scroll': {
      const move = ['xdotool', 'mousemove', '--sync', String(input.x), String(input.y)];
      if (input.dy === 0) return [move];
      const button = input.dy > 0 ? SCROLL_DOWN : SCROLL_UP;
      return [[...move, 'click', '--repeat', String(Math.abs(input.dy)), '--delay', '20', String(button)]];
    }
    case 'type':
      return [['xdotool', 'type', '--delay', '12', '--clearmodifiers', '--', input.text]];
    case 'key':
      return [['xdotool', 'key', '--clearmodifiers', '--', input.key]];
  }
}

/** `brot-browser <command> <json>`. The JSON is one argv element, never interpreted by a shell. */
export function browserArgv(command: string, args: Record<string, unknown>): string[] {
  return ['brot-browser', command, JSON.stringify(args)];
}
