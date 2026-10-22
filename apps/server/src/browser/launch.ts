import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { delimiter, join, win32 } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

/** Chrome writes the DevTools port it chose (we ask for 0) to this file in the profile directory. */
const DEVTOOLS_FILE = 'DevToolsActivePort';
const START_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 20_000;
const CONNECT_ATTEMPT_MS = 5_000;
const KILL_GRACE_MS = 3_000;
const PORT_POLL_MS = 100;
const STDERR_LIMIT = 4_096;

/** The Chrome installs we look for, in order. Names without a separator are looked up on PATH. */
const MACOS_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const LINUX_CANDIDATES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'brave-browser'];
const WINDOWS_VENDORS = ['Google/Chrome/Application/chrome.exe', 'Chromium/Application/chrome.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe', 'Microsoft/Edge/Application/msedge.exe'];

export interface ChromeLaunchOptions {
  /** `--user-data-dir`. Reusing it keeps cookies and logins across launches. */
  profile: string;
  /** Show a window so the person can sign in. Otherwise Chrome runs headless. */
  headed?: boolean;
  /**
   * Port of the bot's egress proxy. Every request, loopback included, goes through it while it is set;
   * the headed login window leaves it unset because the person is driving that window.
   */
  proxyPort?: number;
}

export interface ChromeHandle {
  readonly cdpUrl: string;
  readonly browser: Browser;
  /** Resolves when the Chrome process exits, for any reason including our own close. */
  readonly exited: Promise<void>;
  isRunning(): boolean;
  /** SIGTERM, then SIGKILL, then disconnect. Idempotent. */
  close(): Promise<void>;
}

/** The argv for one launch. Exported so the containment flags can be asserted without starting a browser. */
export function chromeArgs(options: ChromeLaunchOptions): string[] {
  const args = [
    `--user-data-dir=${options.profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-pings',
    '--disable-dev-shm-usage',
  ];
  if (options.headed === true) args.push('--window-size=1280,800');
  else args.push('--headless=new');
  if (options.proxyPort !== undefined) {
    args.push(`--proxy-server=http://127.0.0.1:${options.proxyPort}`);
    // Chrome implicitly sends loopback around the proxy; subtract that bypass so 127.0.0.1 is refused too.
    args.push('--proxy-bypass-list=<-loopback>');
  }
  return args;
}

/** The candidate binary names for this platform. Exported so the lookup order is under test. */
export function chromeCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin') return [...MACOS_CANDIDATES];
  if (platform === 'win32') {
    const programFiles = env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = env.LOCALAPPDATA;
    const roots = [programFiles, programFilesX86, localAppData ?? win32.join(env.USERPROFILE ?? 'C:\\Users\\Public', 'AppData', 'Local')];
    return [
      ...WINDOWS_VENDORS.flatMap((vendor) => roots.map((root) => win32.join(root, ...vendor.split('/')))),
    ];
  }
  return [...LINUX_CANDIDATES];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolves a bare name on the given PATH, or undefined. */
function pathLookup(name: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

function resolveCandidate(candidate: string, env: NodeJS.ProcessEnv): string | undefined {
  if (candidate.includes('/') || candidate.includes('\\')) return isExecutable(candidate) ? candidate : undefined;
  return pathLookup(candidate, env);
}

/**
 * The Chrome binary to drive: the explicit one, then `BROT_BROWSER_PATH`, then the platform's usual install
 * locations. Throws with every path it tried instead of falling back to a browser that is not Chrome.
 */
export function resolveChromeBinary(
  binary?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (binary !== undefined && binary !== '') {
    if (!isExecutable(binary)) throw new Error(`the browser binary ${binary} does not exist or is not executable`);
    return binary;
  }
  const configured = env.BROT_BROWSER_PATH;
  if (configured !== undefined && configured !== '') {
    if (!isExecutable(configured)) {
      throw new Error(`BROT_BROWSER_PATH points at ${configured}, which does not exist or is not executable`);
    }
    return configured;
  }
  const candidates = chromeCandidates(platform, env);
  for (const candidate of candidates) {
    const resolved = resolveCandidate(candidate, env);
    if (resolved !== undefined) return resolved;
  }
  throw new Error(`no Chrome or Chromium was found; tried ${candidates.join(', ')}. Install Google Chrome or set BROT_BROWSER_PATH`);
}

/** The port in a DevToolsActivePort file (first line), or undefined when it is missing or malformed. */
export function parseDevToolsPort(raw: string): number | undefined {
  const first = raw.split(/\r?\n/)[0]?.trim() ?? '';
  if (!/^\d{1,5}$/.test(first)) return undefined;
  const port = Number(first);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/** Removes the DevTools port file a Chrome run left behind, so a restart never reads a stale port. */
export async function removeDevToolsState(profile: string): Promise<void> {
  await rm(join(profile, DEVTOOLS_FILE), { force: true });
}

async function readDevToolsPort(profile: string): Promise<number | undefined> {
  try {
    return parseDevToolsPort(await readFile(join(profile, DEVTOOLS_FILE), 'utf8'));
  } catch {
    return undefined;
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const firstLine = (error: unknown): string => (error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error));

function waitForExit(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  return Promise.race([exited.then(() => true), delay(timeoutMs).then(() => false)]);
}

async function stopProcess(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (!(await waitForExit(exited, KILL_GRACE_MS))) {
    child.kill('SIGKILL');
    await waitForExit(exited, KILL_GRACE_MS);
  }
}

/**
 * Starts Chrome on the bot's profile with a DevTools port, waits for that port, and connects Playwright over
 * CDP. The caller keeps the profile lock and the process alive across commands; `close` is the only way to end
 * it, so a profile is never written by two Chrome instances.
 */
export async function launchChrome(binary: string, options: ChromeLaunchOptions): Promise<ChromeHandle> {
  const { profile } = options;
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await removeDevToolsState(profile);

  const child = spawn(binary, chromeArgs(options), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-STDERR_LIMIT);
  });

  let ended = false;
  let spawnError: Error | undefined;
  const exited = new Promise<void>((resolve) => {
    const settle = (): void => {
      if (ended) return;
      ended = true;
      resolve();
    };
    child.once('exit', settle);
    child.once('error', (error) => {
      spawnError = error;
      settle();
    });
    child.once('close', settle);
  });

  const failure = (): Error | undefined => {
    if (spawnError !== undefined) return new Error(`Chrome could not start: ${spawnError.message}`);
    if (ended) return new Error(`Chrome exited before it was ready${stderr === '' ? '' : `: ${stderr.trim().split('\n').at(-1) ?? ''}`}`);
    return undefined;
  };

  async function waitForDevToolsPort(): Promise<number> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      const problem = failure();
      if (problem !== undefined) throw problem;
      const port = await readDevToolsPort(profile);
      if (port !== undefined) return port;
      if (Date.now() >= deadline) {
        throw new Error(`Chrome did not open a DevTools port within ${START_TIMEOUT_MS / 1000} s`);
      }
      await delay(PORT_POLL_MS);
    }
  }

  async function connect(cdpUrl: string): Promise<Browser> {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    for (;;) {
      try {
        return await chromium.connectOverCDP(cdpUrl, { timeout: CONNECT_ATTEMPT_MS });
      } catch (error) {
        const problem = failure();
        if (problem !== undefined) throw new Error(`${problem.message} (${firstLine(error)})`, { cause: error });
        if (Date.now() >= deadline) {
          throw new Error(`Chrome did not accept a DevTools connection within ${CONNECT_TIMEOUT_MS / 1000} s: ${firstLine(error)}`, {
            cause: error,
          });
        }
        await delay(250);
      }
    }
  }

  let port: number;
  let browser: Browser;
  try {
    port = await waitForDevToolsPort();
    browser = await connect(`http://127.0.0.1:${port}`);
  } catch (error) {
    await stopProcess(child, exited);
    await removeDevToolsState(profile).catch(() => undefined);
    throw error;
  }

  let closing: Promise<void> | undefined;
  return {
    cdpUrl: `http://127.0.0.1:${port}`,
    browser,
    exited,
    isRunning: () => !ended && child.exitCode === null && child.signalCode === null,
    close: () => {
      closing ??= (async () => {
        await stopProcess(child, exited);
        await browser.close().catch(() => undefined);
        await removeDevToolsState(profile).catch(() => undefined);
      })();
      return closing;
    },
  };
}
