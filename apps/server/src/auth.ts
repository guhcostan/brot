import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { Device, DeviceRole } from '@brot/protocol';
import type { Repos } from '@brot/db';

/** Transport details that the Node adapter attaches as `c.env`. Absent for in-process `app.request()` calls. */
export interface Bindings {
  incoming?: { socket?: { remoteAddress?: string } };
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: { device?: Device };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Loopback callers are the local user and need no token. With `trustLoopback` false nothing counts as local.
 * A request with no transport address is an in-process call, which is local only when trusted.
 */
export function isLocalRequest(c: Context<AppEnv>, trustLoopback: boolean): boolean {
  if (!trustLoopback) return false;
  const env: Bindings | undefined = c.env;
  const address = env?.incoming?.socket?.remoteAddress;
  return address === undefined || LOOPBACK.has(address);
}

/** Viewers read. Approvers also answer approvals. Full devices do everything. */
export function roleAllows(role: DeviceRole, method: string, path: string): boolean {
  if (role === 'full') return true;
  if (method === 'GET' || method === 'HEAD') return true;
  if (role === 'approver') return method === 'POST' && /^\/api\/approvals\/[^/]+$/.test(path);
  return false;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Trusted local requests must name a loopback host. A DNS-rebinding page reaches the server with its own
 * hostname in the Host header, which this rejects. In-process calls send no Host header and pass.
 */
function hostIsLoopback(c: Context<AppEnv>): boolean {
  const host = c.req.header('host');
  if (host === undefined) return true;
  return LOOPBACK_HOSTNAMES.has(host.replace(/:\d+$/, '').toLowerCase());
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Browsers send cross-origin requests without a CORS preflight only when they are "simple", and a simple
 * request cannot carry application/json. Requiring that type on state-changing calls therefore forces a
 * preflight, which the CORS allow-list rejects for other origins.
 */
export function requireJsonWrites(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const contentType = c.req.header('content-type') ?? '';
    if (UNSAFE_METHODS.has(c.req.method) && !/^application\/json\b/i.test(contentType)) {
      return c.json({ error: 'State-changing requests must send Content-Type: application/json' }, 415);
    }
    return next();
  };
}

const PUBLIC_ROUTES = new Set(['GET /api/health', 'POST /api/pairing/complete']);

export function authenticate(options: { devices: Repos['devices']; trustLoopback: boolean }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const local = isLocalRequest(c, options.trustLoopback);
    if (local && !hostIsLoopback(c)) return c.json({ error: 'Host header is not a loopback address' }, 403);
    if (local || PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`)) return next();

    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
    if (!match?.[1]) return c.json({ error: 'Authentication required' }, 401);

    const device = await options.devices.findByTokenHash(hashDeviceToken(match[1]));
    if (!device) return c.json({ error: 'Invalid device token' }, 401);
    if (!roleAllows(device.role, c.req.method, c.req.path)) {
      return c.json({ error: `The ${device.role} role cannot ${c.req.method} ${c.req.path}` }, 403);
    }

    await options.devices.touch(device.id);
    c.set('device', device);
    return next();
  };
}
