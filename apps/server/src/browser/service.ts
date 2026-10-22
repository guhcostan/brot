import { rm } from 'node:fs/promises';
import type { Bot, BrowserTakeover, ComputerInput } from '@brot/protocol';
import { applyInput, ensurePage, fillLogin as fillLoginInPage, inputProblem, pageHost as pageHostOf, runBrowserCommand, screenshot } from './driver';
import { botAllowlist, createBotEgress, type BotEgress } from './egress';
import { launchChrome, removeDevToolsState, resolveChromeBinary, type ChromeHandle } from './launch';
import { ensureProfileDir, profileDir } from './profile';
import type { HostBrowserDeps, HostBrowserService, HostBrowserState, LoginCredentials } from './types';

/** What the bot is told when it asks for the browser while the person's sign-in window is open. */
const LOGIN_REFUSAL = 'the person is signing in; try again when the window closes';

/** What the bot is told when it asks to drive while the person has the browser. */
export const BROWSER_TAKEOVER_REFUSAL = 'The person is in control of the browser; wait until they hand it back.';
/** Input during a sign-in window goes to that local window, not the API. */
const LOGIN_INPUT_REFUSAL = 'The browser is in its sign-in window; type and click in that window.';

/** A host-browser failure a route can report with a status code. */
export class BrowserError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

/** A profile's takeover as the API reports it, plus who asked for it (kept for the bot-initiated case). */
interface TakeoverRecord {
  readonly takeover: BrowserTakeover;
  readonly requestedBy: 'user' | 'bot';
  readonly threadId?: string;
}

interface ProfileBrowser {
  readonly state: Exclude<HostBrowserState, 'stopped'>;
  readonly chrome: ChromeHandle;
  /** Only bot browsing has one; the login window is deliberately unproxied. */
  readonly egress?: BotEgress;
  /** The allowlist this Chrome's egress proxy enforces. Another bot's command may restart it. */
  readonly allow: readonly string[];
}

/** The unit a Chrome serves: a shared profile id, or the bot's own id when it names no profile. */
function profileKey(bot: Bot): string {
  return bot.browserProfileId ?? bot.id;
}

/** True when two bots' egress policies allow the same hosts, regardless of entry order. */
function sameAllowlist(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((entry, index) => entry === sortedRight[index]);
}

/**
 * One Chrome and one egress proxy per browser profile, started lazily and driven by `browser`. A bot with no
 * `browserProfileId` owns its profile (keyed by its id, so its directory is the same `browser-profiles/<botId>`
 * it always had); bots that name the same shared profile share one Chrome. Commands on one profile run in
 * order, and different profiles do not wait for each other.
 *
 * Egress is enforced per Chrome, not per profile: a profile's browser runs with the allowlist of the bot whose
 * command started it. When another bot of the same profile has a different allowlist, its command restarts the
 * Chrome through its own proxy. The profile directory keeps the cookies and logins, so a restart loses only the
 * live page.
 *
 * The login hand-off: `openForLogin` starts a headed, unproxied Chrome and reports `login`; every bot sharing
 * that profile sees it and its commands are refused. Once the person closes the window, the profile (with the
 * new session) is reused by the next command, which relaunches Chrome headless through the bot's egress proxy.
 *
 * The person can also watch any running browser (a JPEG per poll) and take control of a profile. A takeover
 * covers every bot sharing that profile: their commands are refused until it is handed back, while screenshots
 * and input stay allowed. The sign-in window is the exception that wins: while it is open the local window is
 * the input surface, so API input is refused until the person closes it.
 */
export function createHostBrowserService(deps: HostBrowserDeps): HostBrowserService {
  const browsers = new Map<string, ProfileBrowser>();
  const queues = new Map<string, Promise<unknown>>();
  const takeovers = new Map<string, TakeoverRecord>();
  const screenInFlight = new Map<string, Promise<Uint8Array>>();

  const errorLine = (error: unknown): string =>
    error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);

  function takeoverOf(key: string): BrowserTakeover {
    return takeovers.get(key)?.takeover ?? { active: false };
  }

  function requireBrowser(bot: Bot): void {
    if (bot.browser !== true) throw new BrowserError(409, 'This bot has no browser');
  }

  function serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const current = previous.then(work, work);
    queues.set(
      key,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  /** Kills Chrome, closes the proxy and drops the DevTools port file. Safe to call more than once. */
  async function end(info: ProfileBrowser, key: string): Promise<void> {
    if (browsers.get(key) === info) browsers.delete(key);
    await info.chrome.close().catch(() => undefined);
    await info.egress?.close().catch(() => undefined);
    await removeDevToolsState(profileDir(deps.home, key)).catch(() => undefined);
  }

  function track(info: ProfileBrowser, key: string): void {
    browsers.set(key, info);
    // A crash must not leave a dead browser in the map: reap it, and report stopped from then on.
    info.chrome.exited
      .then(() => {
        if (browsers.get(key) !== info) return;
        browsers.delete(key);
        void end(info, key).catch(() => undefined);
      })
      .catch(() => undefined);
  }

  function loginWindowOpen(info: ProfileBrowser): boolean {
    if (!info.chrome.isRunning() || !info.chrome.browser.isConnected()) return false;
    return info.chrome.browser.contexts().some((context) => context.pages().length > 0);
  }

  /** The live browser for a profile, after reaping a crash or a login window the person closed. */
  async function live(key: string): Promise<ProfileBrowser | undefined> {
    const info = browsers.get(key);
    if (info === undefined) return undefined;
    const usable = info.state === 'login' ? loginWindowOpen(info) : info.chrome.isRunning();
    if (!usable) {
      await end(info, key);
      return undefined;
    }
    return info;
  }

  async function launchForBrowsing(bot: Bot, key: string): Promise<ProfileBrowser> {
    const binary = resolveChromeBinary(deps.binary);
    const profile = await ensureProfileDir(deps.home, key);
    const egress = await createBotEgress(bot);
    try {
      const chrome = await launchChrome(binary, { profile, proxyPort: egress.port });
      const info: ProfileBrowser = { state: 'running', chrome, egress, allow: [...botAllowlist(bot)] };
      track(info, key);
      return info;
    } catch (error) {
      await egress.close().catch(() => undefined);
      throw error;
    }
  }

  async function launchForLogin(bot: Bot, key: string): Promise<ProfileBrowser> {
    const binary = resolveChromeBinary(deps.binary);
    const profile = await ensureProfileDir(deps.home, key);
    const chrome = await launchChrome(binary, { profile, headed: true });
    const info: ProfileBrowser = { state: 'login', chrome, allow: [] };
    try {
      track(info, key);
      await ensurePage(chrome.browser);
      return info;
    } catch (error) {
      await end(info, key);
      throw error;
    }
  }

  async function stateOf(key: string): Promise<HostBrowserState> {
    const info = await live(key);
    return info?.state ?? 'stopped';
  }

  return {
    status(bot) {
      const key = profileKey(bot);
      return serial(key, async () => ({ state: await stateOf(key) }));
    },

    openForLogin(bot) {
      const key = profileKey(bot);
      return serial(key, async () => {
        const existing = browsers.get(key);
        if (existing !== undefined) await end(existing, key);
        await launchForLogin(bot, key);
        return { state: 'login' };
      });
    },

    browser(bot, command, args) {
      const key = profileKey(bot);
      return serial(key, async () => {
        let info = await live(key);
        if (info !== undefined && info.state === 'login') throw new Error(LOGIN_REFUSAL);
        if (takeoverOf(key).active) throw new Error(BROWSER_TAKEOVER_REFUSAL);
        const allow = botAllowlist(bot);
        if (info !== undefined && !sameAllowlist(info.allow, allow)) {
          // A profile has one Chrome and one egress policy at a time. A bot with a different policy restarts it
          // rather than browsing under another bot's allowlist. The profile (cookies, logins) survives.
          await end(info, key);
          info = undefined;
        }
        info ??= await launchForBrowsing(bot, key);
        try {
          return await runBrowserCommand(info.chrome.browser, bot, command, args);
        } catch (error) {
          // A dead Chrome is reaped here so the next command starts a fresh one; command errors keep it running.
          if (!info.chrome.isRunning()) await end(info, key);
          throw error;
        }
      });
    },

    browserScreen(bot) {
      const key = profileKey(bot);
      // The panel polls several times a second; concurrent polls for one profile share a single capture.
      const pending = screenInFlight.get(key);
      if (pending !== undefined) return pending;
      const capture = serial(key, async () => {
        requireBrowser(bot);
        let info = await live(key);
        if (info === undefined) {
          // Opening the panel starts the browser, so the person can see the page before the bot's first command.
          try {
            info = await launchForBrowsing(bot, key);
          } catch (error) {
            throw new BrowserError(409, `The browser could not start: ${errorLine(error)}`);
          }
        }
        try {
          return await screenshot(await ensurePage(info.chrome.browser));
        } catch (error) {
          throw new BrowserError(409, `The browser is not running: ${errorLine(error)}`);
        }
      }).finally(() => screenInFlight.delete(key));
      screenInFlight.set(key, capture);
      return capture;
    },

    pageHost(bot) {
      const key = profileKey(bot);
      return serial(key, async () => {
        requireBrowser(bot);
        const info = await live(key);
        return info === undefined ? null : pageHostOf(info.chrome.browser);
      });
    },

    fillLogin(bot, credentials: LoginCredentials) {
      const key = profileKey(bot);
      return serial(key, async () => {
        requireBrowser(bot);
        if (takeoverOf(key).active) throw new BrowserError(409, BROWSER_TAKEOVER_REFUSAL);
        let info = await live(key);
        if (info !== undefined && info.state === 'login') throw new BrowserError(409, LOGIN_REFUSAL);
        if (info === undefined) {
          try {
            info = await launchForBrowsing(bot, key);
          } catch (error) {
            throw new BrowserError(409, `The browser could not start: ${errorLine(error)}`);
          }
        }
        // The driver checks the page host again itself, so a redirect while waiting for approval cannot make the
        // credentials land on another site.
        try {
          await fillLoginInPage(await ensurePage(info.chrome.browser), credentials);
        } catch (error) {
          throw new BrowserError(409, errorLine(error));
        }
      });
    },

    browserTakeover(bot) {
      const key = profileKey(bot);
      return serial(key, async () => {
        requireBrowser(bot);
        return takeoverOf(key);
      });
    },

    setBrowserTakeover(bot, change, requestedBy, threadId) {
      const key = profileKey(bot);
      return serial(key, async () => {
        requireBrowser(bot);
        const takeover: BrowserTakeover = {
          active: change.active,
          ...(change.active ? { since: new Date().toISOString() } : {}),
          ...(change.reason === undefined ? {} : { reason: change.reason }),
        };
        // No bus event exists for a host-browser takeover: the panel polls this state. requestedBy and threadId
        // are kept on the record so a bot-initiated takeover can be surfaced without changing the API shape.
        takeovers.set(key, { takeover, requestedBy, ...(threadId === undefined ? {} : { threadId }) });
        return takeover;
      });
    },

    browserInput(bot, input: ComputerInput) {
      const key = profileKey(bot);
      return serial(key, async () => {
        requireBrowser(bot);
        if (!takeoverOf(key).active) throw new BrowserError(409, 'No takeover is active.');
        const problem = inputProblem(input);
        if (problem !== undefined) throw new BrowserError(400, problem);
        const info = await live(key);
        if (info === undefined) throw new BrowserError(409, 'The browser is not running.');
        // The sign-in window is the person's local input surface; routing clicks here too would fight it.
        if (info.state === 'login') throw new BrowserError(409, LOGIN_INPUT_REFUSAL);
        try {
          await applyInput(await ensurePage(info.chrome.browser), input);
        } catch (error) {
          throw new BrowserError(409, errorLine(error));
        }
      });
    },

    close(bot) {
      const key = profileKey(bot);
      return serial(key, async () => {
        const info = browsers.get(key);
        if (info !== undefined) {
          await end(info, key);
          return;
        }
        await removeDevToolsState(profileDir(deps.home, key)).catch(() => undefined);
      });
    },

    deleteProfile(bot) {
      // A shared profile outlives any one bot; it is deleted through its own route, which also ungroups its bots.
      if (bot.browserProfileId !== undefined) return Promise.resolve();
      const key = profileKey(bot);
      return serial(key, async () => {
        const info = browsers.get(key);
        if (info !== undefined) await end(info, key);
        takeovers.delete(key);
        await rm(profileDir(deps.home, key), { recursive: true, force: true });
      });
    },

    statusForProfile(profileId) {
      return serial(profileId, async () => ({ state: await stateOf(profileId) }));
    },

    closeProfile(profileId) {
      return serial(profileId, async () => {
        const info = browsers.get(profileId);
        if (info !== undefined) {
          await end(info, profileId);
          return;
        }
        await removeDevToolsState(profileDir(deps.home, profileId)).catch(() => undefined);
      });
    },

    deleteProfileDir(profileId) {
      return serial(profileId, async () => {
        const info = browsers.get(profileId);
        if (info !== undefined) await end(info, profileId);
        takeovers.delete(profileId);
        await rm(profileDir(deps.home, profileId), { recursive: true, force: true });
      });
    },

    async closeAll() {
      const keys = new Set([...browsers.keys(), ...queues.keys()]);
      await Promise.all(
        [...keys].map((key) =>
          serial(key, async () => {
            const info = browsers.get(key);
            if (info !== undefined) await end(info, key);
          }),
        ),
      );
      takeovers.clear();
      screenInFlight.clear();
    },
  };
}
