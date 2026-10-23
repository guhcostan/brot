/** Where the webhook receiver listens, from `GET /api/webhooks`; absent when the server did not report it. */
export interface WebhookInfo {
  port?: number;
}

/** Reads `GET /api/webhooks` without trusting it; a bad or missing port becomes undefined. */
export function parseWebhookInfo(value: unknown): WebhookInfo {
  if (typeof value !== 'object' || value === null) return {};
  const port = (value as Record<string, unknown>).port;
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65_535 ? { port } : {};
}

/** Strips a trailing `:port` from a hostname (and keeps IPv6 brackets intact). */
export function stripPort(hostname: string): string {
  const trimmed = hostname.trim();
  if (trimmed === '') return '';
  const ipv6 = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (ipv6 !== null) return `[${ipv6[1]}]`;
  const withPort = /^([^:]+):\d+$/.exec(trimmed);
  if (withPort !== null) return withPort[1]!;
  return trimmed;
}

/** The host the web app is served from, for building webhook URLs; `127.0.0.1` in SSR and tests. */
export function webhookHostname(scope: unknown = globalThis): string {
  if (typeof scope === 'object' && scope !== null) {
    const location = (scope as { location?: { hostname?: unknown } }).location;
    const hostname = location?.hostname;
    if (typeof hostname === 'string') {
      const cleaned = stripPort(hostname);
      if (cleaned !== '') return cleaned;
    }
  }
  return '127.0.0.1';
}

/**
 * The URL callers POST to: `http://<hostname>:<port>/h/<secret>`. The secret is the credential and is
 * URL-encoded; without a port the URL carries a `<port>` placeholder so the UI can ask for it instead.
 */
export function webhookUrl(hostname: string, port: number | undefined, secret: string): string {
  const host = stripPort(hostname) === '' ? '127.0.0.1' : stripPort(hostname);
  return `http://${host}:${port === undefined ? '<port>' : String(port)}/h/${encodeURIComponent(secret)}`;
}
