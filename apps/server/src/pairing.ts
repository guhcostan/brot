import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Repos } from '@brot/db';
import type { PairingComplete, PairingCompleteResponse, PairingStartResponse } from '@brot/protocol';
import { hashDeviceToken } from './auth';

export const PAIRING_TTL_MS = 120_000;
/** Failed attempts from one address inside `PAIRING_FAILURE_WINDOW_MS` that lock it. */
export const PAIRING_MAX_FAILURES = 5;
export const PAIRING_FAILURE_WINDOW_MS = 60_000;
/** How long an address stays locked after too many failures. */
export const PAIRING_LOCK_MS = 10 * 60_000;
/** The attempts map is bounded: past this many addresses the least recently active is evicted. */
export const PAIRING_ATTEMPT_CACHE_MAX = 1_000;

/** The key used when a request carries no transport address (in-process calls, tests). */
export const PAIRING_GLOBAL_ADDRESS = '__unknown__';

/** A wrong code and a bad token look the same on purpose, so an attempt reveals nothing about which failed. */
const INVALID_MESSAGE = 'Pairing code is invalid or expired';

export class PairingError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 429,
  ) {
    super(message);
  }
}

export interface PairingCompleteContext {
  /** The caller's transport address, from the socket. Normalized before it becomes a rate-limit key. */
  remoteAddress?: string;
}

export interface Pairing {
  start(endpoint: { host: string; port: number }): PairingStartResponse;
  /** Consumes the token on every non-locked attempt, then checks the code. */
  complete(input: PairingComplete, context?: PairingCompleteContext): Promise<PairingCompleteResponse>;
}

interface PendingPairing {
  expiresAt: number;
  code: string;
}

interface AttemptRecord {
  /** Timestamps of recent failures, inside the window. */
  failures: number[];
  /** Until when the address is locked, or 0. */
  lockedUntil: number;
  lastAttempt: number;
}

/**
 * The rate-limit key for a transport address: IPv4-mapped IPv6 (`::ffff:127.0.0.1`) becomes IPv4
 * (`127.0.0.1`), a `host:port` loses its port, and a bracketed IPv6 host loses its brackets, so one caller
 * always uses one key. No address means the global fallback.
 */
export function normalizePairingAddress(address: string | undefined): string {
  if (address === undefined || address.trim() === '') return PAIRING_GLOBAL_ADDRESS;
  let value = address.trim();
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(value);
  if (bracketed?.[1] !== undefined) value = bracketed[1];
  if (value.startsWith('::ffff:') && value.includes('.')) value = value.slice(7);
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (ipv4WithPort?.[1] !== undefined) value = ipv4WithPort[1];
  return value.toLowerCase();
}

/** Compares the six digits in constant time; unequal lengths are a mismatch without calling timingSafeEqual. */
function codeMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function lockedMessage(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Too many failed pairing attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * Device pairing. The desktop shows a QR payload with a short-lived single-use token and a six-digit code; the
 * phone posts both. The token is consumed on every non-locked attempt, so a wrong code never leaves a retry.
 * Failures are counted per caller address in memory: `PAIRING_MAX_FAILURES` inside `PAIRING_FAILURE_WINDOW_MS`
 * lock that address for `PAIRING_LOCK_MS`. No timers: entries are pruned on use and the map is bounded.
 */
export function createPairing(deps: { repos: Repos; now?: () => number }): Pairing {
  const now = deps.now ?? (() => Date.now());
  /** Pending pairing tokens, held in memory only. Each token maps to its expiry and its code. */
  const pending = new Map<string, PendingPairing>();
  /** Recent failures per caller address. */
  const attempts = new Map<string, AttemptRecord>();

  function prunePending(): void {
    const current = now();
    for (const [token, entry] of pending) {
      if (entry.expiresAt <= current) pending.delete(token);
    }
  }

  function pruneAttempts(current: number): void {
    for (const [address, entry] of attempts) {
      const locked = entry.lockedUntil > current;
      const recent = entry.failures.some((at) => current - at < PAIRING_FAILURE_WINDOW_MS);
      if (!locked && !recent) attempts.delete(address);
    }
  }

  /** Drops the least recently active address so the map stays bounded. */
  function evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [address, entry] of attempts) {
      if (entry.lastAttempt < oldestAt) {
        oldestAt = entry.lastAttempt;
        oldestKey = address;
      }
    }
    if (oldestKey === undefined) oldestKey = attempts.keys().next().value;
    if (oldestKey !== undefined) attempts.delete(oldestKey);
  }

  function recordFor(address: string): AttemptRecord {
    const existing = attempts.get(address);
    if (existing !== undefined) return existing;
    const created: AttemptRecord = { failures: [], lockedUntil: 0, lastAttempt: 0 };
    attempts.set(address, created);
    if (attempts.size > PAIRING_ATTEMPT_CACHE_MAX) evictOldest();
    return created;
  }

  function lockRemaining(address: string, current: number): number {
    const entry = attempts.get(address);
    if (entry === undefined || entry.lockedUntil <= current) return 0;
    return entry.lockedUntil - current;
  }

  function recordFailure(address: string, current: number): void {
    const entry = recordFor(address);
    entry.lastAttempt = current;
    entry.failures = entry.failures.filter((at) => current - at < PAIRING_FAILURE_WINDOW_MS);
    entry.failures.push(current);
    if (entry.failures.length >= PAIRING_MAX_FAILURES) {
      entry.lockedUntil = current + PAIRING_LOCK_MS;
      entry.failures = [];
    }
  }

  return {
    start({ host, port }) {
      prunePending();
      const token = randomBytes(32).toString('base64url');
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const expiresAt = now() + PAIRING_TTL_MS;
      pending.set(token, { expiresAt, code });
      return {
        token,
        code,
        expiresAt: new Date(expiresAt).toISOString(),
        qrPayload: JSON.stringify({ v: 1, host, port, token, code }),
      };
    },

    async complete(input, context = {}) {
      const current = now();
      prunePending();
      pruneAttempts(current);
      const address = normalizePairingAddress(context.remoteAddress);

      // A locked address is refused before the token is touched, so a blocked caller cannot burn a valid token.
      const lockedFor = lockRemaining(address, current);
      if (lockedFor > 0) throw new PairingError(lockedMessage(lockedFor), 429);

      const entry = pending.get(input.token);
      // Single use: the token is consumed even when it turns out to be expired, or the code is wrong.
      pending.delete(input.token);
      if (entry === undefined || entry.expiresAt <= current || !codeMatches(entry.code, input.code)) {
        recordFailure(address, current);
        throw new PairingError(INVALID_MESSAGE, 401);
      }

      attempts.delete(address);
      const deviceToken = randomBytes(32).toString('base64url');
      const device = await deps.repos.devices.create({
        name: input.deviceName,
        role: input.role,
        publicKey: input.publicKey,
        tokenHash: hashDeviceToken(deviceToken),
      });
      return { deviceId: device.id, deviceToken };
    },
  };
}
