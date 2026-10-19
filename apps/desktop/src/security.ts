export const LOOPBACK_HOST = '127.0.0.1';

export type NavigationDecision = 'allow' | 'open-external' | 'block';

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function parse(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** Same-origin navigation stays in the window. Web links go to the system browser. Everything else is blocked. */
export function decideNavigation(target: string, appOrigin: string): NavigationDecision {
  const url = parse(target);
  if (url === undefined) return 'block';
  if (url.origin === appOrigin) return 'allow';
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? 'open-external' : 'block';
}

/** The only URLs handed to the OS. Blocks file:, custom schemes and anything that does not parse. */
export function isSafeExternalUrl(value: string): boolean {
  const url = parse(value);
  return url !== undefined && EXTERNAL_PROTOCOLS.has(url.protocol);
}

export function loopbackOrigins(port: number): string[] {
  return [`http://${LOOPBACK_HOST}:${port}`, `http://localhost:${port}`];
}

/**
 * Rejects Host headers that are not the gateway's own loopback address. A DNS-rebinding page reaches the
 * gateway under its own hostname, and the gateway forwards to a server that trusts loopback callers.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (host === undefined) return false;
  return loopbackOrigins(port).some((origin) => origin.slice('http://'.length) === host.toLowerCase());
}

export function isLoopbackOrigin(origin: string, port: number): boolean {
  return loopbackOrigins(port).includes(origin);
}

export type CspMode = { kind: 'app' } | { kind: 'dev'; origin: string };

/**
 * `app` serves the built UI from the gateway, so scripts come only from the same origin. `dev` adds what
 * Vite needs: an inline React Refresh preamble and the HMR websocket on the dev server.
 */
export function contentSecurityPolicy(mode: CspMode): string {
  if (mode.kind === 'app') {
    return [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
  }
  const hmr = mode.origin.replace(/^http/, 'ws');
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${hmr}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
