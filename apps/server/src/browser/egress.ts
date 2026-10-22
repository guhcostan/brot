import type { Bot } from '@brot/protocol';
import { createEgressProxy, hostAllowed, normalizeHost } from '../computers/egress-proxy';

/** The hosts a bot may reach: its allowlist under `allowlist`, nothing under `deny` or with no policy. */
export function botAllowlist(bot: Bot): readonly string[] {
  return bot.egress?.mode === 'allowlist' ? bot.egress.allow : [];
}

/**
 * True when the bot's policy lists `host`. This is only a fast, clear refusal before a navigation starts; the
 * proxy still decides every request, including redirects and subresources.
 */
export function hostAllowedForBot(bot: Bot, host: string): boolean {
  // Mirror the proxy's normalization so the fast refusal and the boundary agree on case and trailing dots.
  const allow = botAllowlist(bot).map((entry) => normalizeHost(entry));
  return hostAllowed(normalizeHost(host), allow);
}

export interface BotEgress {
  /** The loopback port Chrome is pointed at with `--proxy-server`. */
  readonly port: number;
  /** Stops the proxy. Idempotent. */
  close(): Promise<void>;
}

/**
 * Starts the bot's egress proxy on a loopback port. It is the containment boundary for bot browsing: every
 * request from Chrome, loopback included, arrives here and is refused unless the bot's policy allows the host
 * and its resolved addresses are public. Reuses the computer's proxy so both paths enforce the same rules.
 */
export async function createBotEgress(bot: Bot, onBlocked?: (host: string) => void): Promise<BotEgress> {
  const server = createEgressProxy(
    { allow: botAllowlist(bot), sourceCidr: null },
    { onBlocked: (host) => onBlocked?.(host) },
  );
  const port = await server.listen(0, '127.0.0.1');
  let closing: Promise<void> | undefined;
  return { port, close: () => (closing ??= server.close()) };
}
