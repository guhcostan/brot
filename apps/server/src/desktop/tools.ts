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
const TakeoverInput = z.object({ reason: z.string().min(1).max(500) });

/**
 * The tools that only a bot desktop has: a screenshot and a human takeover. The browser tools live in
 * `browser/tools.ts`, because a bot may browse on the host instead of in its computer.
 */
export function createDesktopTools(deps: DesktopToolDeps): BrotTool[] {
  const { repos, desktop, takeovers } = deps;

  async function desktopBot(scope: ApprovalScope): Promise<Bot | undefined> {
    const bot = await repos.bots.get(scope.botId);
    return bot?.desktop === true && bot.computer === 'sandbox' ? bot : undefined;
  }

  /**
   * A tool that drives the desktop. It refuses to run while the person has control, and it refuses a bot with
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

  const desktopFailure = (error: unknown): ToolResult => ({
    ok: false,
    output: error instanceof Error ? error.message : String(error),
  });

  return [
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
          return desktopFailure(error);
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
