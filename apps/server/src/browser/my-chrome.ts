import type { Repos } from '@brot/db';
import { BrowserMode, DEFAULT_MY_CHROME_ENDPOINT, MyChromeSettings, type Bot, type UpdateMyChromeSettings } from '@brot/protocol';

/**
 * The copy the Settings panel and errors show. The port and profile are Brot-specific on purpose: a browser
 * another automation app already drives must not be attached to.
 */
export const MY_CHROME_HINT =
  'Point My Chrome at your own Chrome started with --user-data-dir="$HOME/.brot-my-chrome" --remote-debugging-port=9333. A browser already used by another automation app must not be used.';

/** The settings row that holds the person's Chrome endpoint. */
export const MY_CHROME_SETTINGS_KEY = 'my-chrome';
/** One settings row per bot that attached to My Chrome, so no schema change is needed. */
export const BOT_BROWSER_MODE_KEY_PREFIX = 'bot-browser-mode:';

export function botBrowserModeKey(botId: string): string {
  return `${BOT_BROWSER_MODE_KEY_PREFIX}${botId}`;
}

export function defaultMyChromeSettings(): MyChromeSettings {
  return { endpoint: DEFAULT_MY_CHROME_ENDPOINT };
}

/** The stored endpoint, or the loopback default. A stored value that no longer validates is still returned so the
 * route can explain it instead of silently connecting somewhere else. */
export async function readMyChromeSettings(repos: Pick<Repos, 'settings'>): Promise<MyChromeSettings> {
  return (await repos.settings.get(MY_CHROME_SETTINGS_KEY, MyChromeSettings)) ?? defaultMyChromeSettings();
}

export async function saveMyChromeSettings(
  repos: Pick<Repos, 'settings'>,
  input: UpdateMyChromeSettings,
  now: Date = new Date(),
): Promise<MyChromeSettings> {
  const settings: MyChromeSettings = { endpoint: input.endpoint, updatedAt: now.toISOString() };
  await repos.settings.set(MY_CHROME_SETTINGS_KEY, settings);
  return settings;
}

/** True when a value was stored, so the route can say the person's Chrome setting is back to the default. */
export async function clearMyChromeSettings(repos: Pick<Repos, 'settings'>): Promise<boolean> {
  return repos.settings.remove(MY_CHROME_SETTINGS_KEY);
}

/** The bot's stored host-browser mode, if it ever chose one. Absent means `own`. */
export async function readBotBrowserMode(repos: Pick<Repos, 'settings'>, botId: string): Promise<BrowserMode | undefined> {
  return repos.settings.get(botBrowserModeKey(botId), BrowserMode);
}

/** Stores the mode; `own` deletes the row so the settings table only holds non-default choices. */
export async function saveBotBrowserMode(
  repos: Pick<Repos, 'settings'>,
  botId: string,
  mode: BrowserMode,
): Promise<void> {
  if (mode === 'own') {
    await repos.settings.remove(botBrowserModeKey(botId));
    return;
  }
  await repos.settings.set(botBrowserModeKey(botId), mode);
}

export async function clearBotBrowserMode(repos: Pick<Repos, 'settings'>, botId: string): Promise<void> {
  await repos.settings.remove(botBrowserModeKey(botId));
}

/**
 * The mode a bot really browses in: the entity's own field when a response carries it, otherwise the stored
 * setting. A bot's repo row has no browser_mode column, so the server layer owns this value.
 */
export async function effectiveBrowserMode(repos: Pick<Repos, 'settings'>, bot: Bot): Promise<BrowserMode> {
  if (bot.browserMode !== undefined) return bot.browserMode;
  return (await readBotBrowserMode(repos, bot.id)) ?? 'own';
}

/** A bot as the API reports it: `browserMode` is sent only when it is `my-chrome` (absent means own). */
export async function withBrowserMode(repos: Pick<Repos, 'settings'>, bot: Bot): Promise<Bot> {
  const mode = await effectiveBrowserMode(repos, bot);
  return mode === 'my-chrome' ? { ...bot, browserMode: 'my-chrome' } : bot;
}

export async function withBrowserModes(repos: Pick<Repos, 'settings'>, bots: Bot[]): Promise<Bot[]> {
  return Promise.all(bots.map((bot) => withBrowserMode(repos, bot)));
}
