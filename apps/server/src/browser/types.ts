import type { Bot } from '@brot/protocol';

/** What a bot's host browser is doing. `login` means a headed window is open for the person to sign in. */
export type HostBrowserState = 'stopped' | 'running' | 'login';

export interface HostBrowserStatus {
  state: HostBrowserState;
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

export interface HostBrowserService extends BrowserDriver {
  status(bot: Bot): Promise<HostBrowserStatus>;
  /**
   * Starts a headed browser with the bot's profile so the person can sign in, and leaves it open. The
   * next time the bot uses the browser the window closes and the profile (with the session) is reused.
   * The window is not proxied: the person is driving it, and sign-in flows reach sites the bot's egress
   * policy does not cover.
   */
  openForLogin(bot: Bot): Promise<HostBrowserStatus>;
  /** Closes the bot's browser, saving its profile. Idempotent. */
  close(bot: Bot): Promise<void>;
  /** Closes the browser and deletes its profile, for a bot that is being deleted. Idempotent. */
  deleteProfile(bot: Bot): Promise<void>;
  closeAll(): Promise<void>;
}

export interface HostBrowserDeps {
  /** The Brot home; profiles live in `<home>/browser-profiles/<botId>`. */
  home: string;
  /** Chrome binary. Defaults to `BROT_BROWSER_PATH`, then the usual macOS/Linux/Windows locations. */
  binary?: string;
}
