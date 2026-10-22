import { describe, expect, it } from 'vitest';
import { chromeArgs, chromeCandidates, parseDevToolsPort, resolveChromeBinary } from './launch';

describe('chromeArgs', () => {
  it('runs headless on the bot profile behind the egress proxy', () => {
    const args = chromeArgs({ profile: '/profiles/bot_1', proxyPort: 43123 });
    expect(args).toContain('--user-data-dir=/profiles/bot_1');
    expect(args).toContain('--remote-debugging-port=0');
    expect(args).toContain('--headless=new');
    expect(args).not.toContain('--window-size=1280,800');
    expect(args).toContain('--proxy-server=http://127.0.0.1:43123');
    // Without subtracting the implicit bypass, Chrome would send 127.0.0.1 straight to the network.
    expect(args).toContain('--proxy-bypass-list=<-loopback>');
    for (const flag of [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--no-pings',
      '--disable-dev-shm-usage',
    ]) {
      expect(args).toContain(flag);
    }
  });

  it('opens a headed, unproxied window for login', () => {
    const args = chromeArgs({ profile: '/profiles/bot_1', headed: true });
    expect(args).toContain('--window-size=1280,800');
    expect(args).not.toContain('--headless=new');
    expect(args.some((arg) => arg.startsWith('--proxy-server'))).toBe(false);
    expect(args.some((arg) => arg.startsWith('--proxy-bypass-list'))).toBe(false);
  });
});

describe('chromeCandidates', () => {
  it('looks in /Applications on macOS', () => {
    const candidates = chromeCandidates('darwin');
    expect(candidates[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(candidates.join('\n')).toMatch(/Chromium\.app/);
    expect(candidates.join('\n')).toMatch(/Brave Browser\.app/);
    expect(candidates.join('\n')).toMatch(/Microsoft Edge\.app/);
  });

  it('looks up the usual names on PATH on linux', () => {
    expect(chromeCandidates('linux')).toEqual([
      'google-chrome',
      'google-chrome-stable',
      'chromium',
      'chromium-browser',
      'brave-browser',
    ]);
  });

  it('looks in the Program Files locations on windows', () => {
    const candidates = chromeCandidates('win32', { PROGRAMFILES: 'C:\\PF', LOCALAPPDATA: 'C:\\LAD', 'PROGRAMFILES(X86)': 'C:\\PFX' });
    expect(candidates).toContain('C:\\PF\\Google\\Chrome\\Application\\chrome.exe');
    expect(candidates).toContain('C:\\PFX\\Microsoft\\Edge\\Application\\msedge.exe');
    expect(candidates).toContain('C:\\LAD\\Google\\Chrome\\Application\\chrome.exe');
  });
});

describe('resolveChromeBinary', () => {
  it('uses an explicit binary when it is executable', () => {
    expect(resolveChromeBinary(process.execPath)).toBe(process.execPath);
  });

  it('refuses an explicit binary that does not exist, naming it', () => {
    expect(() => resolveChromeBinary('/nonexistent/brot-chrome')).toThrow(/\/nonexistent\/brot-chrome/);
  });

  it('honours BROT_BROWSER_PATH and refuses a bad one', () => {
    expect(resolveChromeBinary(undefined, { BROT_BROWSER_PATH: process.execPath })).toBe(process.execPath);
    expect(() => resolveChromeBinary(undefined, { BROT_BROWSER_PATH: '/nonexistent/brot-chrome' })).toThrow(/BROT_BROWSER_PATH/);
  });

  it('lists the candidates it tried when there is no Chrome', () => {
    expect(() => resolveChromeBinary(undefined, { PROGRAMFILES: '/nonexistent/pf' }, 'win32')).toThrow(/tried .*chrome\.exe/);
  });
});

describe('parseDevToolsPort', () => {
  it('reads the port from the first line', () => {
    expect(parseDevToolsPort('43123\n/devtools/browser/9d2f')).toBe(43123);
    expect(parseDevToolsPort('43123')).toBe(43123);
  });

  it('rejects a malformed or stale file', () => {
    expect(parseDevToolsPort('')).toBeUndefined();
    expect(parseDevToolsPort('not-a-port\n/devtools')).toBeUndefined();
    expect(parseDevToolsPort('0')).toBeUndefined();
    expect(parseDevToolsPort('65536')).toBeUndefined();
  });
});
