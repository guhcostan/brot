import type { Repos } from '@brot/db';
import type { Bot } from '@brot/protocol';
import { z } from 'zod';
import type { ApprovalScope } from '../broker';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall, ToolResult } from '../mcp/types';
import { TAKEOVER_REFUSAL, type TakeoverState } from './takeover';
import { TAKEOVER_WAIT_MS, type DesktopService } from './service';

interface DesktopToolDeps {
  repos: Repos;
  desktop: DesktopService;
  takeovers: TakeoverState;
  /** Waiting for a takeover to end. Tests shorten it. */
  takeoverWaitMs?: number;
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
const TakeoverInput = z.object({ reason: z.string().min(1).max(500) });

/** Every bot desktop tool, for bots that have `desktop: true` on a sandbox computer. Other bots never see them. */
export function createDesktopTools(deps: DesktopToolDeps): BrotTool[] {
  const { repos, desktop, takeovers } = deps;

  async function desktopBot(scope: ApprovalScope): Promise<Bot | undefined> {
    const bot = await repos.bots.get(scope.botId);
    return bot?.desktop === true && bot.computer === 'sandbox' ? bot : undefined;
  }

  /**
   * A tool that drives the browser. It refuses to run while the person has control, and it refuses a bot with
   * no desktop before any approval is asked.
   */
  function driving<T>(
    name: string,
    description: string,
    schema: z.ZodType<T>,
    risk: 'read' | 'write',
    describe: (args: T) => string,
    check: (bot: Bot, args: T) => Promise<string | undefined>,
    run: (bot: Bot, args: T) => Promise<ToolResult>,
    allowedDuringTakeover = false,
  ): BrotTool {
    return {
      spec: { name, description, inputSchema: inputSchemaOf(schema), risk },
      enabledFor: async (scope) => (await desktopBot(scope)) !== undefined,
      async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
        const bot = await desktopBot(scope);
        if (!bot) return { error: 'This bot has no desktop.' };
        const parsed = schema.safeParse(raw);
        if (!parsed.success) return { error: invalidArguments(parsed.error) };
        if (!allowedDuringTakeover && takeovers.isActive(bot.id)) return { error: TAKEOVER_REFUSAL };
        const refusal = await check(bot, parsed.data);
        if (refusal !== undefined) return { error: refusal };
        return {
          risk,
          kind: 'other',
          summary: describe(parsed.data).slice(0, 300),
          async run() {
            return run(bot, parsed.data);
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
      async (bot, { url }) => {
        try {
          const page = await desktop.browser(bot, 'open', { url });
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
      async (bot) => {
        try {
          const page = await desktop.browser(bot, 'snapshot', {});
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
      async (bot, { ref }) => {
        try {
          const page = await desktop.browser(bot, 'click', { ref: String(ref) });
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
      async (bot, { ref, text }) => {
        if (/secret:\/\//.test(text)) {
          return 'Secret values cannot be typed by the bot. Call request_takeover and let the person enter them.';
        }
        try {
          const info = await desktop.browser(bot, 'field', { ref: String(ref) });
          if (info.sensitive === true) {
            return `Refused: element ${ref} is ${String(info.reason ?? 'a sensitive field')}. Call request_takeover and let the person fill it.`;
          }
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        return undefined;
      },
      async (bot, { ref, text, submit }) => {
        try {
          await desktop.browser(bot, 'type', { ref: String(ref), text, submit: submit === true });
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
      async (bot, { key }) => {
        try {
          await desktop.browser(bot, 'key', { key });
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
      async (bot, { direction }) => {
        try {
          await desktop.browser(bot, 'scroll', { direction });
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
      async (bot) => {
        try {
          const page = await desktop.browser(bot, 'back', {});
          return { ok: true, output: `Back at "${String(page.title ?? '')}" (${String(page.url ?? '')}).` };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'computer_screenshot',
      'See the bot desktop as an image. Use it only when the text snapshot is not enough.',
      Empty,
      'read',
      () => "Capture the bot's screen",
      none,
      async (bot) => {
        try {
          const jpeg = await desktop.screen(bot);
          return {
            ok: true,
            output: 'Screenshot of the bot desktop (JPEG).',
            image: { mimeType: 'image/jpeg', data: Buffer.from(jpeg).toString('base64') },
          };
        } catch (error) {
          return browserFailure(error);
        }
      },
    ),

    driving(
      'request_takeover',
      'Ask the person to take over the bot desktop (for a sign-in, a CAPTCHA, a 2FA code or a payment they must approve). This waits until they hand control back, for up to 15 minutes.',
      TakeoverInput,
      'read',
      ({ reason }) => `Ask the person to take over the browser: ${reason}`,
      none,
      async (bot, { reason }) => {
        if (!takeovers.isActive(bot.id)) {
          await desktop.setTakeover(bot, { active: true, reason }, 'bot');
        }
        const returned = await desktop.waitForControlBack(bot.id);
        if (returned) return { ok: true, output: 'Control is back. Take a new snapshot.' };
        return {
          ok: false,
          output: `The person has not handed control back within ${Math.round((deps.takeoverWaitMs ?? TAKEOVER_WAIT_MS) / 60_000)} minutes. Call request_takeover again to keep waiting.`,
        };
      },
      true,
    ),
  ];
}
