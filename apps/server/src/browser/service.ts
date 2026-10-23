import { rm } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright-core';
import { BrowserMode, DEFAULT_MY_CHROME_ENDPOINT, MyChromeSettings, type Bot, type BrowserTakeover, type ComputerInput } from '@brot/protocol';
import { applyInput, ensurePage, fillLogin as fillLoginInPage, inputProblem, pageHost as pageHostOf, runBrowserCommand, screenshot } from './driver';
import { botAllowlist, createBotEgress, type BotEgress } from './egress';
import { launchChrome, removeDevToolsState, resolveChromeBinary, type ChromeHandle } from './launch';
import { botBrowserModeKey, MY_CHROME_HINT, MY_CHROME_SETTINGS_KEY } from './my-chrome';
import { ensureProfileDir, profileDir } from './profile';
import type { HostBrowserDeps, HostBrowserService, HostBrowserState, LoginCredentials, MyChromeProbe } from './types';

/** What the bot is told when it asks for the browser while the person's sign-in window is open. */
const LOGIN_REFUSAL = 'the person is signing in; try again when the window closes';

/** What the bot is told when it asks to drive while the person has the browser. */
export const BROWSER_TAKEOVER_REFUSAL = 'The person is in control of the browser; wait until they hand it back.';
/** Input during a sign-in window goes to that local window, not the API. */
const LOGIN_INPUT_REFUSAL = 'The browser is in its sign-in window; type and click in that window.';

/** My Chrome: the run attaches to the person's own Chrome, so it is never launched, proxied or closed by Brot. */
const MY_CHROME_KEY = 'my-chrome';
const MY_CHROME_TIMEOUT_MS = 5_000;
const MY_CHROME_LOGIN_REFUSAL =
  'My Chrome is already signed in; switch the bot to its own profile to sign in from Brot.';
const myChromeUnreachable = (endpoint: string): string =>
  `Could not reach Chrome at ${endpoint}. ${MY_CHROME_HINT}`;

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

  /** The person's Chrome CDP endpoint: the stored setting, or the loopback default. */
  async function myChromeEndpoint(): Promise<string> {
    const stored = await deps.settings?.get(MY_CHROME_SETTINGS_KEY, MyChromeSettings);
    return stored?.endpoint ?? DEFAULT_MY_CHROME_ENDPOINT;
  }

  /** True when this bot's runs attach to the person's Chrome. The bot row has no mode column, so the setting
   * (or an entity that already carries the mode) decides. */
  async function usesMyChrome(bot: Bot): Promise<boolean> {
    if (bot.browser !== true) return false;
    if (bot.browserMode !== undefined) return bot.browserMode === 'my-chrome';
    if (deps.settings === undefined) return false;
    return (await deps.settings.get(botBrowserModeKey(bot.id), BrowserMode)) === 'my-chrome';
  }

  /** Our CDP handle to the person's Chrome. It is kept between commands; releasing one never affects the browser. */
  let myChrome: { endpoint: string; browser: Browser } | undefined;

  /** Connects to the person's Chrome (or reuses our live handle), with the short timeout a run can wait for. */
  async function attachMyChrome(): Promise<{ endpoint: string; browser: Browser }> {
    const endpoint = await myChromeEndpoint();
    if (myChrome !== undefined && myChrome.endpoint === endpoint && myChrome.browser.isConnected()) return myChrome;
    if (myChrome !== undefined) {
      const stale = myChrome.browser;
      myChrome = undefined;
      await stale.close().catch(() => undefined);
    }
    const connect =
      deps.connectOverCDP ??
      ((url: string, timeoutMs?: number) => chromium.connectOverCDP(url, timeoutMs === undefined ? {} : { timeout: timeoutMs }));
    try {
      const browser = await connect(endpoint, MY_CHROME_TIMEOUT_MS);
      myChrome = { endpoint, browser };
      return { endpoint, browser };
    } catch {
      throw new BrowserError(409, myChromeUnreachable(endpoint));
    }
  }

  /** Disconnects our handle only. The person's Chrome and its tabs keep running. */
  function detachMyChrome(): void {
    const handle = myChrome;
    myChrome = undefined;
    if (handle !== undefined) void handle.browser.close().catch(() => undefined);
  }

  /** The browser's own description (product, user agent) over CDP, so a probe shows what it reached. */
  async function myChromeInfo(browser: Browser): Promise<{ version?: string; userAgent?: string } | undefined> {
    const info: { version?: string; userAgent?: string } = {};
    try {
      info.version = browser.version();
    } catch {
      // Older browsers may not answer; the CDP session below is the fallback.
    }
    try {
      const session = await browser.newBrowserCDPSession();
      try {
        const version = (await session.send('Browser.getVersion')) as { product?: string; userAgent?: string };
        if (typeof version.product === 'string') info.version = version.product;
        if (typeof version.userAgent === 'string') info.userAgent = version.userAgent;
      } finally {
        await session.detach().catch(() => undefined);
      }
    } catch {
      // The identity is best effort; a probe that connected still reports available.
    }
    if (info.userAgent === undefined) {
      try {
        const page = browser.contexts()[0]?.pages()[0];
        if (page !== undefined) {
          const agent = await page.evaluate('navigator.userAgent');
          if (typeof agent === 'string') info.userAgent = agent;
        }
      } catch {
        // No page or no evaluation rights: the identifier stays partial.
      }
    }
    return info.version === undefined && info.userAgent === undefined ? undefined : info;
  }

  /** The status a My Chrome bot reports: connected or not, with the endpoint the run would use. */
  async function myChromeStatus(): Promise<{ state: HostBrowserState; mode: 'my-chrome'; endpoint: string }> {
    try {
      const attached = await attachMyChrome();
      return { state: attached.browser.isConnected() ? 'running' : 'stopped', mode: 'my-chrome', endpoint: attached.endpoint };
    } catch {
      return { state: 'stopped', mode: 'my-chrome', endpoint: await myChromeEndpoint().catch(() => DEFAULT_MY_CHROME_ENDPOINT) };
    }
  }

  async function probeMyChrome(): Promise<MyChromeProbe> {
    const endpoint = await myChromeEndpoint();
    try {
      const attached = await attachMyChrome();
      const connected = attached.browser.isConnected();
      const browser = connected ? await myChromeInfo(attached.browser) : undefined;
      detachMyChrome();
      const automation = /headlesschrome|playwright|puppeteer/i.test(browser?.userAgent ?? '');
      if (automation) console.warn(`My Chrome probe reached an automation browser at ${endpoint}. ${MY_CHROME_HINT}`);
      return connected
        ? { endpoint, available: true, ...(browser === undefined ? {} : { browser, automation }) }
        : { endpoint, available: false, reason: myChromeUnreachable(endpoint) };
    } catch (error) {
      return {
        endpoint,
        available: false,
        reason: error instanceof BrowserError ? error.message : myChromeUnreachable(endpoint),
      };
    }
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
      return (async () => {
        if (await usesMyChrome(bot)) return myChromeStatus();
        const key = profileKey(bot);
        return serial(key, async () => ({ state: await stateOf(key) }));
      })();
    },

    probeMyChrome,

    openForLogin(bot) {
      return (async () => {
        if (await usesMyChrome(bot)) throw new BrowserError(409, MY_CHROME_LOGIN_REFUSAL);
        const key = profileKey(bot);
        return serial(key, async () => {
          const existing = browsers.get(key);
          if (existing !== undefined) await end(existing, key);
          await launchForLogin(bot, key);
          return { state: 'login' };
        });
      })();
    },

    async browser(bot, command, args) {
      if (await usesMyChrome(bot)) {
        return serial(MY_CHROME_KEY, async () => {
          if (takeoverOf(MY_CHROME_KEY).active) throw new Error(BROWSER_TAKEOVER_REFUSAL);
          const { browser: cdp } = await attachMyChrome();
          try {
            // The person's Chrome keeps its own network: the bot's egress allowlist is not applied, and no proxy
            // is inserted. The viewport is left alone because resizing their window would be intrusive.
            return await runBrowserCommand(cdp, bot, command, args, { unproxied: true, viewport: false });
          } catch (error) {
            if (!cdp.isConnected()) detachMyChrome();
            throw error;
          }
        });
      }
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
      return (async () => {
        if (await usesMyChrome(bot)) {
          const pending = screenInFlight.get(MY_CHROME_KEY);
          if (pending !== undefined) return pending;
          const capture = serial(MY_CHROME_KEY, async () => {
            requireBrowser(bot);
            try {
              const { browser: cdp } = await attachMyChrome();
              return await screenshot(await ensurePage(cdp, { viewport: false }));
            } catch (error) {
              if (error instanceof BrowserError) throw error;
              throw new BrowserError(409, `The browser is not running: ${errorLine(error)}`);
            }
          }).finally(() => screenInFlight.delete(MY_CHROME_KEY));
          screenInFlight.set(MY_CHROME_KEY, capture);
          return capture;
        }
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
      })();
    },

    pageHost(bot) {
      return (async () => {
        if (await usesMyChrome(bot)) {
          return serial(MY_CHROME_KEY, async () => {
            requireBrowser(bot);
            const { browser: cdp } = await attachMyChrome();
            return pageHostOf(cdp);
          });
        }
        const key = profileKey(bot);
        return serial(key, async () => {
          requireBrowser(bot);
          const info = await live(key);
          return info === undefined ? null : pageHostOf(info.chrome.browser);
        });
      })();
    },

    fillLogin(bot, credentials: LoginCredentials) {
      return (async () => {
        if (await usesMyChrome(bot)) {
          return serial(MY_CHROME_KEY, async () => {
            requireBrowser(bot);
            if (takeoverOf(MY_CHROME_KEY).active) throw new BrowserError(409, BROWSER_TAKEOVER_REFUSAL);
            try {
              const { browser: cdp } = await attachMyChrome();
              await fillLoginInPage(await ensurePage(cdp, { viewport: false }), credentials);
            } catch (error) {
              if (error instanceof BrowserError) throw error;
              throw new BrowserError(409, errorLine(error));
            }
          });
        }
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
      })();
    },

    browserTakeover(bot) {
      return (async () => {
        const key = (await usesMyChrome(bot)) ? MY_CHROME_KEY : profileKey(bot);
        return serial(key, async () => {
          requireBrowser(bot);
          return takeoverOf(key);
        });
      })();
    },

    setBrowserTakeover(bot, change, requestedBy, threadId) {
      return (async () => {
        const key = (await usesMyChrome(bot)) ? MY_CHROME_KEY : profileKey(bot);
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
      })();
    },

    browserInput(bot, input: ComputerInput) {
      return (async () => {
        const key = (await usesMyChrome(bot)) ? MY_CHROME_KEY : profileKey(bot);
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
      })();
    },

    close(bot) {
      return (async () => {
        if (await usesMyChrome(bot)) {
          // Closing a My Chrome bot only drops our CDP handle; the person's Chrome stays open.
          detachMyChrome();
          return;
        }
        const key = profileKey(bot);
        return serial(key, async () => {
        const info = browsers.get(key);
        if (info !== undefined) {
          await end(info, key);
          return;
        }
        await removeDevToolsState(profileDir(deps.home, key)).catch(() => undefined);
        });
      })();
    },

    deleteProfile(bot) {
      return (async () => {
        // My Chrome has no profile directory to delete and the person's browser is never touched.
        if (await usesMyChrome(bot)) {
          detachMyChrome();
          return;
        }
        // A shared profile outlives any one bot; it is deleted through its own route, which also ungroups its bots.
        if (bot.browserProfileId !== undefined) return;
        const key = profileKey(bot);
        return serial(key, async () => {
          const info = browsers.get(key);
          if (info !== undefined) await end(info, key);
          takeovers.delete(key);
          await rm(profileDir(deps.home, key), { recursive: true, force: true });
        });
      })();
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
      detachMyChrome();
      takeovers.clear();
      screenInFlight.clear();
    },
  };
}
