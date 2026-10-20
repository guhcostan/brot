import { describe, expect, it } from 'vitest';
import { browserArgv, DESKTOP_ENV, desktopStartArgv, inputArgv, screenshotArgv } from './commands';
import { createTakeoverState, TAKEOVER_REFUSAL } from './takeover';

describe('screen capture', () => {
  it('captures the root window as JPEG on stdout, with fixed argv', () => {
    expect(screenshotArgv()).toEqual(['import', '-window', 'root', '-quality', '70', 'jpeg:-']);
    expect(DESKTOP_ENV).toEqual({ DISPLAY: ':1' });
    expect(desktopStartArgv()).toEqual(['brot-desktop-start']);
  });
});

describe('input mapping', () => {
  it('moves then clicks with the mapped button', () => {
    expect(inputArgv({ type: 'click', x: 10, y: 20, button: 'right', double: false })).toEqual([
      ['xdotool', 'mousemove', '--sync', '10', '20', 'click', '--repeat', '1', '--delay', '80', '3'],
    ]);
    expect(inputArgv({ type: 'click', x: 1, y: 2, button: 'middle', double: true })[0]).toEqual([
      'xdotool', 'mousemove', '--sync', '1', '2', 'click', '--repeat', '2', '--delay', '80', '2',
    ]);
  });

  it('maps positive dy to scroll down (button 5) and negative to scroll up (button 4)', () => {
    expect(inputArgv({ type: 'scroll', x: 5, y: 6, dy: 3 })).toEqual([
      ['xdotool', 'mousemove', '--sync', '5', '6', 'click', '--repeat', '3', '--delay', '20', '5'],
    ]);
    expect(inputArgv({ type: 'scroll', x: 5, y: 6, dy: -2 })).toEqual([
      ['xdotool', 'mousemove', '--sync', '5', '6', 'click', '--repeat', '2', '--delay', '20', '4'],
    ]);
    expect(inputArgv({ type: 'scroll', x: 5, y: 6, dy: 0 })).toEqual([['xdotool', 'mousemove', '--sync', '5', '6']]);
  });

  it('types text as one literal argument after the -- separator', () => {
    expect(inputArgv({ type: 'type', text: '-rf $(whoami) ; `id`' })).toEqual([
      ['xdotool', 'type', '--delay', '12', '--clearmodifiers', '--', '-rf $(whoami) ; `id`'],
    ]);
  });

  it('sends a key name as one argument', () => {
    expect(inputArgv({ type: 'key', key: 'ctrl+l' })).toEqual([['xdotool', 'key', '--clearmodifiers', '--', 'ctrl+l']]);
  });

  it('moves the pointer only for move events', () => {
    expect(inputArgv({ type: 'move', x: 7, y: 8 })).toEqual([['xdotool', 'mousemove', '--sync', '7', '8']]);
  });
});

describe('browser commands', () => {
  it('passes the JSON arguments as one argv element, never a shell string', () => {
    const argv = browserArgv('type', { ref: '3', text: 'a"; rm -rf / #' });
    expect(argv).toEqual(['brot-browser', 'type', JSON.stringify({ ref: '3', text: 'a"; rm -rf / #' })]);
    expect(argv).toHaveLength(3);
  });
});

describe('takeover state', () => {
  it('records who has control and reports it as active', () => {
    const state = createTakeoverState();
    expect(state.get('bot_1')).toBeNull();
    expect(state.isActive('bot_1')).toBe(false);
    const taken = state.set('bot_1', { active: true, reason: 'Sign in', requestedBy: 'bot' }, new Date('2026-10-20T10:00:00Z'));
    expect(taken).toEqual({ botId: 'bot_1', active: true, reason: 'Sign in', requestedBy: 'bot', at: '2026-10-20T10:00:00.000Z' });
    expect(state.isActive('bot_1')).toBe(true);
    state.set('bot_1', { active: false, requestedBy: 'user' });
    expect(state.isActive('bot_1')).toBe(false);
    expect(state.get('bot_1')?.requestedBy).toBe('user');
  });

  it('keeps each bot separate', () => {
    const state = createTakeoverState();
    state.set('bot_a', { active: true, requestedBy: 'user' });
    expect(state.isActive('bot_b')).toBe(false);
  });

  it('uses the exact refusal text from the spec', () => {
    expect(TAKEOVER_REFUSAL).toBe('The person has control of the computer right now. Wait, or call request_takeover.');
  });
});
