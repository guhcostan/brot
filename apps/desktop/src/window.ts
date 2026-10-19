import type { BrowserWindowConstructorOptions } from 'electron';
import { color } from '@brot/ui/tokens';
import { SECURE_WEB_PREFERENCES } from './web-preferences';

/**
 * Three-pane minimum from apps/web/src/App.tsx: 264px sidebar, 320px context panel, and at least 440px of
 * thread. The thread column is the only flexible pane.
 */
export const MIN_WINDOW_WIDTH = 264 + 320 + 440;
export const MIN_WINDOW_HEIGHT = 600;

export interface WindowInput {
  platform: NodeJS.Platform;
  dark: boolean;
  devTools: boolean;
}

export function backgroundColorFor(dark: boolean): string {
  return dark ? color.dark.bg : color.light.bg;
}

/** Built before the page loads, so the window opens in the right background and never flashes white. */
export function buildWindowOptions({ platform, dark, devTools }: WindowInput): BrowserWindowConstructorOptions {
  const mac = platform === 'darwin';
  return {
    width: 1280,
    height: 800,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: backgroundColorFor(dark),
    ...(mac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: { ...SECURE_WEB_PREFERENCES, devTools },
  };
}
