import type { Bot, ComputerHandle, EgressPolicy } from '@brot/protocol';

/** Where a contained run reaches the Brot server (the MCP endpoint), bypassing the egress proxy. */
export interface InternalEndpoint {
  /** Base URL as seen from inside the computer: the egress sidecar relay for docker (`http://brot-egress:<port>`), loopback for host. */
  url: string;
}

export interface ComputerProvider {
  readonly id: 'docker' | 'host';
  /** Whether this provider can run here, and why not. */
  available(): Promise<{ ok: true } | { ok: false; reason: string }>;
  /**
   * Starts (or reuses) the bot's computer and returns a handle to exec in it. Egress is limited to
   * `extraHosts` (model provider hosts) plus the bot's own policy; everything else is refused and
   * reported through `onBlocked`.
   */
  ensure(bot: Bot, opts: { extraHosts: string[]; onBlocked(host: string): void }): Promise<ComputerHandle>;
  /** How code inside the computer reaches the Brot server. */
  internalEndpoint(): InternalEndpoint;
  stop(botId: string): Promise<void>;
  close(): Promise<void>;
}

/** The egress the computer actually gets: the bot policy plus the hosts Brot itself needs. */
export function effectiveAllowlist(policy: EgressPolicy | undefined, extraHosts: string[]): string[] {
  const own = policy?.mode === 'allowlist' ? policy.allow : [];
  return [...new Set([...extraHosts, ...own])];
}
