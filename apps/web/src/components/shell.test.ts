import { describe, expect, it } from 'vitest';
import { isMacDesktopShell } from './shell';

const MAC_ELECTRON =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) brot/0.0.0 Chrome/142.0.0.0 Electron/39.2.0 Safari/537.36';
const WIN_ELECTRON =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) brot/0.0.0 Chrome/142.0.0.0 Electron/39.2.0 Safari/537.36';
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

describe('isMacDesktopShell', () => {
  it('matches Electron on macOS only', () => {
    expect(isMacDesktopShell(MAC_ELECTRON)).toBe(true);
    expect(isMacDesktopShell(WIN_ELECTRON)).toBe(false);
    expect(isMacDesktopShell(MAC_CHROME)).toBe(false);
    expect(isMacDesktopShell('')).toBe(false);
  });
});
