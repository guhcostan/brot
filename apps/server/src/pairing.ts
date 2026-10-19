import { randomBytes, randomInt } from 'node:crypto';
import type { Repos } from '@brot/db';
import type { PairingComplete, PairingCompleteResponse, PairingStartResponse } from '@brot/protocol';
import { hashDeviceToken } from './auth';

export const PAIRING_TTL_MS = 120_000;

export class PairingError extends Error {
  constructor(
    message: string,
    readonly status: 401,
  ) {
    super(message);
  }
}

export interface Pairing {
  start(endpoint: { host: string; port: number }): PairingStartResponse;
  complete(input: PairingComplete): Promise<PairingCompleteResponse>;
}

export function createPairing(deps: { repos: Repos; now?: () => number }): Pairing {
  const now = deps.now ?? (() => Date.now());
  /** Pending pairing tokens, held in memory only. Each token maps to its expiry in epoch milliseconds. */
  const pending = new Map<string, number>();

  function prune(): void {
    const current = now();
    for (const [token, expiresAt] of pending) {
      if (expiresAt <= current) pending.delete(token);
    }
  }

  return {
    start({ host, port }) {
      prune();
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now() + PAIRING_TTL_MS;
      pending.set(token, expiresAt);
      return {
        token,
        code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
        expiresAt: new Date(expiresAt).toISOString(),
        qrPayload: JSON.stringify({ v: 1, host, port, token }),
      };
    },

    async complete(input) {
      const expiresAt = pending.get(input.token);
      // Single use: the token is consumed even when it turns out to be expired.
      pending.delete(input.token);
      if (expiresAt === undefined || expiresAt <= now()) {
        throw new PairingError('Pairing token is invalid or expired', 401);
      }
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
