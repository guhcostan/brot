import { randomBytes } from 'node:crypto';
import type { Repos } from '@brot/db';
import type { Routine } from '@brot/protocol';

/** Bytes behind a rotated webhook secret: 32 random bytes, base64url (43 characters). */
export const WEBHOOK_SECRET_BYTES = 32;

/** A fresh unguessable webhook secret, the only credential a webhook URL carries. */
export function generateWebhookSecret(): string {
  return randomBytes(WEBHOOK_SECRET_BYTES).toString('base64url');
}

/**
 * Replaces a webhook routine's secret and persists it. The webhook receiver resolves the secret from the database
 * on every request, so the old URL stops working as soon as this update lands. Returns undefined when the routine
 * disappeared between the read and the write.
 */
export async function rotateRoutineWebhookSecret(
  repos: Pick<Repos, 'routines'>,
  routine: Routine,
): Promise<Routine | undefined> {
  return repos.routines.update(routine.id, { trigger: { type: 'webhook', secret: generateWebhookSecret() } });
}
