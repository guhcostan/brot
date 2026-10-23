import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { roomBatons } from '../schema';
import { nowIso } from './common';

export function createRoomBatonRepo(db: Db) {
  return {
    /** The bot that answers the room's next unmentioned message, or undefined when nobody holds the baton. */
    async get(threadId: string): Promise<string | undefined> {
      const [row] = await db
        .select({ botId: roomBatons.botId })
        .from(roomBatons)
        .where(eq(roomBatons.threadId, threadId))
        .limit(1);
      return row?.botId;
    },

    /** Stores the baton, replacing whoever held it before (a handoff to a new bot overwrites it). */
    async set(threadId: string, botId: string): Promise<void> {
      const updatedAt = nowIso();
      await db
        .insert(roomBatons)
        .values({ threadId, botId, updatedAt })
        .onConflictDoUpdate({ target: roomBatons.threadId, set: { botId, updatedAt } });
    },

    /** Removes the baton, after it is used or when its holder is no longer a member. Returns whether one existed. */
    async clear(threadId: string): Promise<boolean> {
      const rows = await db
        .delete(roomBatons)
        .where(eq(roomBatons.threadId, threadId))
        .returning({ threadId: roomBatons.threadId });
      return rows.length > 0;
    },
  };
}
