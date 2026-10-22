import type { Repos } from '@brot/db';
import type { Bot, SecretRef } from '@brot/protocol';
import { z } from 'zod';
import type { ApprovalScope } from '../broker';
import type { DesktopService } from '../desktop/service';
import { TAKEOVER_REFUSAL, type TakeoverState } from '../desktop/takeover';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall, ToolResult } from '../mcp/types';
import { savedLoginSecretNames } from '../vault';
import { hostMatchesLogin } from './driver';
import { totpCode } from './totp';
import type { BrowserDriver, HostBrowserService } from './types';

export interface BrowserToolDeps {
  repos: Repos;
  /** The bot desktop, when this server has a sandbox computer provider. Its bots browse in their container. */
  desktop?: DesktopService;
  /** The host browser, when this server runs one. Its bots browse in a Chrome on the server machine. */
  host?: HostBrowserService;
  /** The desktop takeover state. A container's browser tools refuse while the person has control. */
  takeovers?: TakeoverState;
}

/** The browser a bot talks to, and the takeover state that can pause it. */
interface BotBrowser {
  driver: BrowserDriver;
  takeovers?: TakeoverState;
}

/**
 * Which browser serves a bot: `desktop` when its container has a screen, `host` when it opted into the server
 * machine's browser, and `none` otherwise. The container wins when a bot has both.
 */
export type BotBrowserKind = 'desktop' | 'host' | 'none';

export function botBrowserKind(bot: Bot): BotBrowserKind {
  if (bot.computer === 'sandbox' && bot.desktop === true) return 'desktop';
  return bot.browser === true ? 'host' : 'none';
}

const Empty = z.object({});
const Ref = z.number().int().min(1).max(999_999);
const OpenInput = z.object({ url: z.url({ protocol: /^https?$/ }).max(2048) });
const ClickInput = z.object({ ref: Ref });
const TypeInput = z.object({
  ref: Ref,
  text: z.string().min(1).max(2000),
  submit: z.boolean().optional(),
});
const KeyInput = z.object({ key: z.string().regex(/^[A-Za-z0-9_+]{1,40}$/) });
const ScrollInput = z.object({ direction: z.enum(['up', 'down']) });
/** fill_login names a saved login; the values never appear in the arguments. */
const FillLoginInput = z.object({ name: z.string().trim().min(1).max(60) });

/**
 * `fill_login`: fills a saved login on the page of a bot's host browser. The values are declared as secret
 * references and resolved by the MCP layer only after the broker allowed the call, so neither the model nor the
 * arguments ever hold them. Only host-browser bots get this tool; a container bot has its own browser.
 */
function fillLoginTool(deps: BrowserToolDeps): BrotTool {
  const host = deps.host;
  return {
    spec: {
      name: 'fill_login',
      description:
        'Fill a saved login on the page the browser is on: types the username and the password (and a one-time code when the saved login has one) as real keystrokes, then submits the form. The values never reach you. The page must be on the site the login was saved for.',
      inputSchema: inputSchemaOf(FillLoginInput),
      risk: 'write',
    },

    async enabledFor(scope) {
      if (host === undefined) return false;
      const bot = await deps.repos.bots.get(scope.botId);
      return bot !== undefined && botBrowserKind(bot) === 'host';
    },

    async prepare(scope, raw) {
      const bot = await deps.repos.bots.get(scope.botId);
      if (host === undefined || bot === undefined || botBrowserKind(bot) !== 'host') {
        return { error: 'This bot has no host browser.' };
      }
      const parsed = FillLoginInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const login = await deps.repos.savedLogins.getByName(parsed.data.name);
      if (login === undefined) return { error: `There is no saved login named "${parsed.data.name}".` };
      const currentHost = await host.pageHost(bot);
      if (currentHost === null) {
        return { error: `Open ${login.host} in the browser first; fill_login fills the current page.` };
      }
      if (!hostMatchesLogin(currentHost, login.host)) {
        return {
          error: `The saved login "${login.name}" is for ${login.host}, but the browser is on ${currentHost}. Open ${login.host} first.`,
        };
      }

      const names = savedLoginSecretNames(login.id);
      const refs: SecretRef[] = [`secret://${names.username}`, `secret://${names.password}`];
      if (login.hasTotp) refs.push(`secret://${names.totp}`);
      return {
        risk: 'write',
        kind: 'other',
        summary: `Fill the saved login "${login.name}" on ${login.host}`,
        secrets: refs,
        async run(secrets) {
          const username = secrets[`secret://${names.username}`];
          const password = secrets[`secret://${names.password}`];
          const totpSecret = login.hasTotp ? secrets[`secret://${names.totp}`] : undefined;
          if (username === undefined || password === undefined || (login.hasTotp && totpSecret === undefined)) {
            return { ok: false, output: 'Brot could not read the saved login.' };
          }
          try {
            await host.fillLogin(bot, {
              host: login.host,
              username,
              password,
              ...(totpSecret === undefined ? {} : { totp: totpCode(totpSecret) }),
            });
          } catch (error) {
            return { ok: false, output: error instanceof Error ? error.message : String(error) };
          }
          return { ok: true, output: `Filled the saved login for ${login.host} and submitted.` };
        },
      };
    },
  };
}

/**
 * The browser tools. They run against the bot's desktop container when it has one, and against the host
 * browser otherwise. Every bot sees them at most once, whichever driver it gets.
 */
export function createBrowserTools(deps: BrowserToolDeps): BrotTool[] {
  const { repos } = deps;

  /** The container wins when a bot has both: a desktop bot's browser lives in its computer, not on the host. */
  function browserFor(bot: Bot): BotBrowser | undefined {
    const kind = botBrowserKind(bot);
    if (kind === 'desktop') {
      return deps.desktop === undefined ? undefined : { driver: deps.desktop, ...(deps.takeovers ? { takeovers: deps.takeovers } : {}) };
    }
    return kind === 'host' && deps.host !== undefined ? { driver: deps.host } : undefined;
  }

  async function resolve(scope: ApprovalScope): Promise<{ bot: Bot; browser: BotBrowser } | undefined> {
    const bot = await repos.bots.get(scope.botId);
    const browser = bot === undefined ? undefined : browserFor(bot);
    return bot === undefined || browser === undefined ? undefined : { bot, browser };
  }

  function driving<T>(
    name: string,
    description: string,
    schema: z.ZodType<T>,
    risk: 'read' | 'write',
    describe: (args: T) => string,
    check: (driver: BrowserDriver, bot: Bot, args: T) => Promise<string | undefined>,
    run: (driver: BrowserDriver, bot: Bot, args: T) => Promise<ToolResult>,
  ): BrotTool {
    return {
      spec: { name, description, inputSchema: inputSchemaOf(schema), risk },
      enabledFor: async (scope) => (await resolve(scope)) !== undefined,
      async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
        const resolved = await resolve(scope);
        if (resolved === undefined) return { error: 'This bot has no browser.' };
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return { error: invalidArguments(parsed.error) };
        if (resolved.browser.takeovers?.isActive(resolved.bot.id) === true) return { error: TAKEOVER_REFUSAL };
        const refusal = await check(resolved.browser.driver, resolved.bot, parsed.data);
        if (refusal !== undefined) return { error: refusal };
        const driver = resolved.browser.driver;
        const bot = resolved.bot;
        return {
          risk,
          kind: 'other',
          summary: describe(parsed.data).slice(0, 300),
          async run() {
            return run(driver, bot, parsed.data);
          },
        };
      },
    };
  }

  const none = async (): Promise<undefined> => undefined;

  const browserFailure = (error: unknown): ToolResult => ({
    ok: false,
    output: error instanceof Error ? error.message : String(error),
  });

  return [
    driving(
      'browser_open',
      "Open a web address in the bot's browser. Navigation is a read, but the computer's egress policy still applies.",
      OpenInput,
      'read',
      ({ url }) => `Open ${url} in the bot's browser`,
      none,
      async (driver, bot, { url }) => {
        try {
          const page = await driver.browser(bot, 'open', { url });
          return { ok: true, output: `Opened "${String(page.title ?? '')}" at ${String(page.url ?? url)}. Take a snapshot to read it.` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'browser_snapshot',
      'Read the browser page as a text tree. Interactive elements carry [ref=N]; use those refs with the click and type tools. Refs are valid until the next snapshot.',
      Empty,
      'read',
      () => "Read the bot's browser page",
      none,
      async (driver, bot) => {
        try {
          const page = await driver.browser(bot, 'snapshot', {});
          return { ok: true, output: `${String(page.title ?? '')} (${String(page.url ?? '')})\n${String(page.text ?? '')}` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'browser_click',
      'Click an element by its [ref=N] from the latest snapshot.',
      ClickInput,
      'write',
      ({ ref }) => `Click element ${ref} in the bot's browser`,
      none,
      async (driver, bot, { ref }) => {
        try {
          const page = await driver.browser(bot, 'click', { ref: String(ref) });
          return { ok: true, output: `Clicked. Now at "${String(page.title ?? '')}" (${String(page.url ?? '')}). Take a snapshot to see the result.` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'browser_type',
      'Type text into a field by its [ref=N]. Refuses secret:// values, password fields and card fields: the person fills those through a takeover.',
      TypeInput,
      'write',
      ({ ref, text }) => `Type "${text.slice(0, 120)}" into element ${ref} in the bot's browser`,
      async (driver, bot, { ref, text }) => {
        if (/secret:\/\//.test(text)) {
          return 'Secret values cannot be typed by the bot. Call request_takeover and let the person enter them.';
        }
        try {
          const info = await driver.browser(bot, 'field', { ref: String(ref) });
          if (info.sensitive === true) {
            return `Refused: element ${ref} is ${String(info.reason ?? 'a sensitive field')}. Call request_takeover and let the person fill it.`;
          }
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        return undefined;
      },
      async (driver, bot, { ref, text, submit }) => {
        try {
          await driver.browser(bot, 'type', { ref: String(ref), text, submit: submit === true });
          return { ok: true, output: `Typed into element ${ref}. Take a snapshot before the next step; refs may have changed.` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'browser_key',
      'Press a key in the browser, for example Enter, Tab, Escape or PageDown.',
      KeyInput,
      'write',
      ({ key }) => `Press ${key} in the bot's browser`,
      none,
      async (driver, bot, { key }) => {
        try {
          await driver.browser(bot, 'key', { key });
          return { ok: true, output: `Pressed ${key}.` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'browser_scroll',
      'Scroll the browser page up or down by about one screen.',
      ScrollInput,
      'read',
      ({ direction }) => `Scroll ${direction} in the bot's browser`,
      none,
      async (driver, bot, { direction }) => {
        try {
          await driver.browser(bot, 'scroll', { direction });
          return { ok: true, output: `Scrolled ${direction}. Take a snapshot to see the new part.` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'browser_back',
      'Go back one page in the browser history.',
      Empty,
      'read',
      () => "Go back in the bot's browser",
      none,
      async (driver, bot) => {
        try {
          const page = await driver.browser(bot, 'back', {});
          return { ok: true, output: `Back at "${String(page.title ?? '')}" (${String(page.url ?? '')}).` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    fillLoginTool(deps),
  ];
}
