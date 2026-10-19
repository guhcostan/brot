import { z } from 'zod';

/**
 * Push notifications are not wired yet. Per docs/REMOTE-CONTROL.md the relay will deliver an
 * encrypted payload carrying only `{ serverId, eventId }`; the app then fetches the event itself.
 * This module fixes that contract so screens can depend on it before the relay ships.
 */
export const PushPayload = z.object({ serverId: z.string().min(1), eventId: z.string().min(1) });
export type PushPayload = z.infer<typeof PushPayload>;

export type PushRegistration = { status: 'unavailable'; reason: string } | { status: 'registered'; pushToken: string };

export async function registerForPush(): Promise<PushRegistration> {
  return { status: 'unavailable', reason: 'Push notifications arrive with the Brot relay.' };
}

export function parsePushPayload(data: unknown): PushPayload | undefined {
  const parsed = PushPayload.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}
