import { describe, expect, it } from 'vitest';
import { DEFAULT_GATEWAY_PORT, resolveDesktopConfig } from './config';

const base = {
  env: {},
  userDataDir: '/data/Brot',
  isPackaged: false,
  resourcesPath: '/app/resources',
  bundleDir: '/repo/apps/desktop/dist',
};

describe('resolveDesktopConfig', () => {
  it('dev server mode uses the ports the Vite proxy expects and the Vite dev URL', () => {
    const config = resolveDesktopConfig({ ...base, devServer: true });
    expect(config.devServer).toBe(true);
    expect(config.server).toEqual({ port: 8799, webhookPort: 8800 });
    expect(config.web).toEqual({ kind: 'url', url: 'http://127.0.0.1:5199' });
  });

  it('app mode embeds the server on ephemeral ports and serves the web build through the gateway', () => {
    const config = resolveDesktopConfig({ ...base, devServer: false });
    expect(config.server).toEqual({ port: 0, webhookPort: 0 });
    expect(config.web).toEqual({
      kind: 'gateway',
      root: '/repo/apps/web/dist',
      port: DEFAULT_GATEWAY_PORT,
    });
  });

  it('packaged builds read the web app from resources', () => {
    const config = resolveDesktopConfig({ ...base, devServer: false, isPackaged: true });
    expect(config.web.kind === 'gateway' && config.web.root).toBe('/app/resources/web');
  });

  it('home is BROT_HOME when set and the userData directory otherwise', () => {
    expect(resolveDesktopConfig({ ...base, devServer: false }).home).toBe('/data/Brot');
    expect(resolveDesktopConfig({ ...base, devServer: false, env: { BROT_HOME: '' } }).home).toBe('/data/Brot');
    expect(resolveDesktopConfig({ ...base, devServer: false, env: { BROT_HOME: '/tmp/x' } }).home).toBe('/tmp/x');
  });

  it('honors BROT_DESKTOP_PORT and rejects values that are not ports', () => {
    const config = resolveDesktopConfig({ ...base, devServer: false, env: { BROT_DESKTOP_PORT: '9100' } });
    expect(config.web.kind === 'gateway' && config.web.port).toBe(9100);
    expect(() => resolveDesktopConfig({ ...base, devServer: false, env: { BROT_DESKTOP_PORT: '70000' } })).toThrow(
      /BROT_DESKTOP_PORT/,
    );
    expect(() => resolveDesktopConfig({ ...base, devServer: false, env: { BROT_DESKTOP_PORT: 'abc' } })).toThrow();
  });
});
