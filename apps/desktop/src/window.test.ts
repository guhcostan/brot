import { color } from '@brot/ui/tokens';
import { describe, expect, it } from 'vitest';
import { backgroundColorFor, buildWindowOptions, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from './window';

describe('buildWindowOptions', () => {
  it('uses the token background for the active appearance so the window never flashes white', () => {
    expect(buildWindowOptions({ platform: 'darwin', dark: false, devTools: false }).backgroundColor).toBe(
      color.light.bg,
    );
    expect(buildWindowOptions({ platform: 'darwin', dark: true, devTools: false }).backgroundColor).toBe(
      color.dark.bg,
    );
    expect(backgroundColorFor(true)).toBe('#0A0A0A');
    expect(backgroundColorFor(false)).toBe('#FFFFFF');
  });

  it('uses a hidden-inset title bar on macOS and the native frame elsewhere', () => {
    const mac = buildWindowOptions({ platform: 'darwin', dark: false, devTools: false });
    expect(mac.titleBarStyle).toBe('hiddenInset');
    expect(mac.trafficLightPosition).toEqual({ x: 16, y: 16 });

    const linux = buildWindowOptions({ platform: 'linux', dark: false, devTools: false });
    expect(linux.titleBarStyle).toBeUndefined();
    expect(linux.trafficLightPosition).toBeUndefined();
  });

  it('keeps the three-pane layout usable: 264 sidebar, 320 context panel, 440 thread', () => {
    const options = buildWindowOptions({ platform: 'darwin', dark: false, devTools: false });
    expect(MIN_WINDOW_WIDTH).toBe(1024);
    expect(options.minWidth).toBe(MIN_WINDOW_WIDTH);
    expect(options.minHeight).toBe(MIN_WINDOW_HEIGHT);
    expect(options.show).toBe(false);
  });

  it('keeps renderer isolation on and gives the page no Node or preload access', () => {
    const { webPreferences } = buildWindowOptions({ platform: 'darwin', dark: false, devTools: false });
    expect(webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: false,
    });
    expect(webPreferences).not.toHaveProperty('preload');
  });

  it('enables devtools only for the dev server', () => {
    expect(buildWindowOptions({ platform: 'darwin', dark: false, devTools: true }).webPreferences?.devTools).toBe(true);
  });
});
