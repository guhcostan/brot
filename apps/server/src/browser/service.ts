import { rm } from 'node:fs/promises';
import type { Bot } from '@brot/protocol';
import { ensurePage, runBrowserCommand } from './driver';
import { createBotEgress, type BotEgress } from './egress';
import { launchChrome, removeDevToolsState, resolveChromeBinary, type ChromeHandle } from './launch';
import { ensureProfileDir, profileDir } from './profile';
import type { HostBrowserDeps, HostBrowserService, HostBrowserState } from './types';

/** What the bot is told when it asks for the browser while the person's sign-in window is open. */
const LOGIN_REFUSAL = 'the person is signing in; try again when the window closes';

interface BotBrowser {
  readonly state: Exclude<HostBrowserState, 'stopped'>;
  readonly chrome: ChromeHandle;
  /** Only bot browsing has one; the login window is deliberately unproxied. */
  readonly egress?: BotEgress;
}

/**
 * One Chrome and one egress proxy per bot, started lazily and driven by `browser`. Commands on one bot run in
 * order; different bots do not wait for each other.
 *
 * The login hand-off: `openForLogin` starts a headed, unproxied Chrome and reports `login`. While the window is
 * open, bot commands are refused. Once the person closes the window, the profile (with the new session) is
 * reused by the next command, which relaunches Chrome headless through the bot's egress proxy.
 */
export function createHostBrowserService(deps: HostBrowserDeps): HostBrowserService {
  const browsers = new Map<string, BotBrowser>();
  const queues = new Map<string, Promise<unknown>>();

  function serial<T>(botId: string, work: () => Promise<T>): Promise<T> {
    const previous = queues.get(botId) ?? Promise.resolve();
    const current = previous.then(work, work);
    queues.set(
      botId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  /** Kills Chrome, closes the proxy and drops the DevTools port file. Safe to call more than once. */
  async function end(info: BotBrowser, botId: string): Promise<void> {
    if (browsers.get(botId) === info) browsers.delete(botId);
    await info.chrome.close().catch(() => undefined);
    await info.egress?.close().catch(() => undefined);
    await removeDevToolsState(profileDir(deps.home, botId)).catch(() => undefined);
  }

  function track(info: BotBrowser, botId: string): void {
    browsers.set(botId, info);
    // A crash must not leave a dead browser in the map: reap it, and report stopped from then on.
    info.chrome.exited
      .then(() => {
        if (browsers.get(botId) !== info) return;
        browsers.delete(botId);
        void end(info, botId).catch(() => undefined);
      })
      .catch(() => undefined);
  }

  function loginWindowOpen(info: BotBrowser): boolean {
    if (!info.chrome.isRunning() || !info.chrome.browser.isConnected()) return false;
    return info.chrome.browser.contexts().some((context) => context.pages().length > 0);
  }

  /** The live browser for this bot, after reaping a crash or a login window the person closed. */
  async function live(bot: Bot): Promise<BotBrowser | undefined> {
    const info = browsers.get(bot.id);
    if (info === undefined) return undefined;
    const usable = info.state === 'login' ? loginWindowOpen(info) : info.chrome.isRunning();
    if (!usable) {
      await end(info, bot.id);
      return undefined;
    }
    return info;
  }

  async function launchForBrowsing(bot: Bot): Promise<BotBrowser> {
    const binary = resolveChromeBinary(deps.binary);
    const profile = await ensureProfileDir(deps.home, bot.id);
    const egress = await createBotEgress(bot);
    try {
      const chrome = await launchChrome(binary, { profile, proxyPort: egress.port });
      const info: BotBrowser = { state: 'running', chrome, egress };
      track(info, bot.id);
      return info;
    } catch (error) {
      await egress.close().catch(() => undefined);
      throw error;
    }
  }

  async function launchForLogin(bot: Bot): Promise<BotBrowser> {
    const binary = resolveChromeBinary(deps.binary);
    const profile = await ensureProfileDir(deps.home, bot.id);
    const chrome = await launchChrome(binary, { profile, headed: true });
    const info: BotBrowser = { state: 'login', chrome };
    try {
      track(info, bot.id);
      await ensurePage(chrome.browser);
      return info;
    } catch (error) {
      await end(info, bot.id);
      throw error;
    }
  }

  return {
    status(bot) {
      return serial(bot.id, async () => {
        const info = await live(bot);
        return { state: info?.state ?? 'stopped' };
      });
    },

    openForLogin(bot) {
      return serial(bot.id, async () => {
        const existing = browsers.get(bot.id);
        if (existing !== undefined) await end(existing, bot.id);
        await launchForLogin(bot);
        return { state: 'login' };
      });
    },

    browser(bot, command, args) {
      return serial(bot.id, async () => {
        let info = await live(bot);
        if (info !== undefined && info.state === 'login') throw new Error(LOGIN_REFUSAL);
        info ??= await launchForBrowsing(bot);
        try {
          return await runBrowserCommand(info.chrome.browser, bot, command, args);
        } catch (error) {
          // A dead Chrome is reaped here so the next command starts a fresh one; command errors keep it running.
          if (!info.chrome.isRunning()) await end(info, bot.id);
          throw error;
        }
      });
    },

    close(bot) {
      return serial(bot.id, async () => {
        const info = browsers.get(bot.id);
        if (info !== undefined) {
          await end(info, bot.id);
          return;
        }
        await removeDevToolsState(profileDir(deps.home, bot.id)).catch(() => undefined);
      });
    },

    deleteProfile(bot) {
      return serial(bot.id, async () => {
        const info = browsers.get(bot.id);
        if (info !== undefined) await end(info, bot.id);
        await rm(profileDir(deps.home, bot.id), { recursive: true, force: true });
      });
    },

    async closeAll() {
      const ids = new Set([...browsers.keys(), ...queues.keys()]);
      await Promise.all(
        [...ids].map((botId) =>
          serial(botId, async () => {
            const info = browsers.get(botId);
            if (info !== undefined) await end(info, botId);
          }),
        ),
      );
    },
  };
}
