import type { Bot, BrowserMode, BrowserTakeover, ComputerInput, SetBrowserTakeover } from '@brot/protocol';
import type { Browser } from 'playwright-core';

/** What a bot's host browser is doing. `login` means a headed window is open for the person to sign in. */
export type HostBrowserState = 'stopped' | 'running' | 'login';

export interface HostBrowserStatus {
  state: HostBrowserState;
  /** `my-chrome` when the bot attaches to the person's Chrome; absent means its own profile. */
  mode?: BrowserMode;
  /** The CDP endpoint of the person's Chrome for a My Chrome bot. */
  endpoint?: string;
}

/** The settings reads the browser needs. `Repos['settings']` satisfies it. */
export interface SettingsStore {
  get<T>(key: string, schema: { parse(value: unknown): T }): Promise<T | undefined>;
}

/** What the probe learned about the reached browser, so the person and the UI can see what they attach to. */
export interface MyChromeBrowserInfo {
  version?: string;
  userAgent?: string;
}

/** What a My Chrome probe found. `reason` is the same text a run sees when Chrome is not listening. */
export interface MyChromeProbe {
  endpoint: string;
  available: boolean;
  /** Absent when the endpoint did not answer. */
  browser?: MyChromeBrowserInfo;
  /** True when the user agent looks like an automation browser (headless, Playwright, Puppeteer). */
  automation?: boolean;
  reason?: string;
}

/**
 * Runs browser commands for a bot. The desktop provider runs them inside the bot's computer; the host
 * provider runs them in a Chrome on the server machine, with the bot's persistent profile.
 *
 * Commands and results are the same vocabulary the desktop image's `brot-browser` uses:
 * `open {url}` -> `{title, url}`, `back {}` -> `{title, url}`, `snapshot {}` -> `{title, url, text}`,
 * `click {ref}` -> `{title, url}`, `type {ref, text, submit}` -> `{}`, `key {key}` -> `{}`,
 * `scroll {direction}` -> `{}`, `field {ref}` -> `{sensitive, reason?}`.
 */
export interface BrowserDriver {
  browser(bot: Bot, command: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/**
 * A host browser runs one Chrome per browser profile, not per bot. A bot either uses its own profile or names a
 * shared one (`bot.browserProfileId`), so several bots can share one signed-in session. Every method below acts
 * on the bot's effective profile.
 */
export interface HostBrowserService extends BrowserDriver {
  /** The state of the browser serving the bot's effective profile. */
  status(bot: Bot): Promise<HostBrowserStatus>;
  /**
   * Starts a headed browser with the bot's effective profile so the person can sign in, and leaves it open.
   * Every bot in a shared profile sees `login` while the window is up. The next time the bot uses the browser
   * the window closes and the profile (with the session) is reused. The window is not proxied: the person is
   * driving it, and sign-in flows reach sites the bot's egress policy does not cover.
   */
  openForLogin(bot: Bot): Promise<HostBrowserStatus>;
  /** Closes the browser for the bot's effective profile, saving it. Affects every bot sharing it. Idempotent. */
  close(bot: Bot): Promise<void>;
  /**
   * Closes the browser and deletes the saved logins, for a bot that is being deleted. Only a bot on its own
   * profile has a directory to delete; a shared profile outlives any one bot and is deleted through its route.
   * Idempotent.
   */
  deleteProfile(bot: Bot): Promise<void>;
  /**
   * A JPEG of the bot's browser for the live view. Starts the browser lazily when the panel is opened, so the
   * person can watch before the bot's first command. Refused for a bot without `browser: true`.
   */
  browserScreen(bot: Bot): Promise<Uint8Array>;
  /** The takeover state of the bot's effective profile. */
  browserTakeover(bot: Bot): Promise<BrowserTakeover>;
  /**
   * Sets the takeover state of the bot's effective profile, so every bot sharing it is in control (or free)
   * together. While active, bot browser commands are refused; input and screenshots are still allowed.
   */
  setBrowserTakeover(
    bot: Bot,
    change: SetBrowserTakeover,
    requestedBy: 'user' | 'bot',
    threadId?: string,
  ): Promise<BrowserTakeover>;
  /**
   * Applies one remote input event to the bot's browser. Refused unless the person's takeover is active on the
   * bot's profile, and while a sign-in window is open (that local window is the input surface then).
   */
  browserInput(bot: Bot, input: ComputerInput): Promise<void>;
  /**
   * The hostname of the page the bot's browser is on, or null when it is not running or on no http(s) page.
   * Used to check that a saved login is being filled on its own site.
   */
  pageHost(bot: Bot): Promise<string | null>;
  /**
   * Types a saved login's values into the current page and submits it. The values never appear in a result or an
   * error. Refused while a sign-in window is open or the person has taken over the profile.
   */
  fillLogin(bot: Bot, credentials: LoginCredentials): Promise<void>;
  /**
   * Whether a My Chrome endpoint answers: connects over CDP, disconnects the probe's own handle and reports the
   * stored endpoint. Never leaves a connection open.
   */
  probeMyChrome(): Promise<MyChromeProbe>;
  /** The state of one profile's browser, by profile key (a shared profile id, or a bot id for an own profile). */
  statusForProfile(profileId: string): Promise<HostBrowserStatus>;
  /** Closes the browser serving a shared profile, saving it. Idempotent. */
  closeProfile(profileId: string): Promise<void>;
  /** Closes the browser and deletes a shared profile's directory, logins included. Idempotent. */
  deleteProfileDir(profileId: string): Promise<void>;
  closeAll(): Promise<void>;
}

/** Values a saved login fills in. They come from the vault only after the broker allowed the call. */
export interface LoginCredentials {
  /** The site the login was saved for. The page must still be on it when the values are typed. */
  readonly host: string;
  readonly username: string;
  readonly password: string;
  /** The current RFC 6238 code, when the login has a TOTP secret. */
  readonly totp?: string;
}

export interface HostBrowserDeps {
  /**
   * The Brot home. Profiles live in `<home>/browser-profiles/<key>`, where the key is a shared profile id or,
   * for a bot's own profile, the bot id.
   */
  home: string;
  /** Chrome binary. Defaults to `BROT_BROWSER_PATH`, then the usual macOS/Linux/Windows locations. */
  binary?: string;
  /** Settings rows: the My Chrome endpoint and each bot's browser mode. Absent disables stored modes. */
  settings?: SettingsStore;
  /** The CDP connector. Tests inject a fake; production uses playwright-core's `chromium.connectOverCDP`. */
  connectOverCDP?: (endpoint: string, timeoutMs?: number) => Promise<Browser>;
}
