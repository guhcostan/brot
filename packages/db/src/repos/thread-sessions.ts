import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../client';
import { threads, threadSessions } from '../schema';
import { nowIso } from './common';

/**
 * The engine session each bot resumes in a thread. DMs use `threads.engineSessionId`; a room has one bot
 * per member, so each member keeps its own session here.
 */
export function createThreadSessionRepo(db: Db) {
  return {
    /** The session `botId` resumes in `threadId`, or undefined when it has none. */
    async get(threadId: string, botId: string): Promise<string | undefined> {
      const [row] = await db
        .select({ engineSessionId: threadSessions.engineSessionId })
        .from(threadSessions)
        .where(and(eq(threadSessions.threadId, threadId), eq(threadSessions.botId, botId)))
        .limit(1);
      return row?.engineSessionId ?? undefined;
    },

    /**
     * Stores the session for one bot in one thread, creating the row on first use, or clears it with null.
     * The row stays after a clear, so `updatedAt` still records the change.
     */
    async set(threadId: string, botId: string, sessionId: string | null): Promise<void> {
      const timestamp = nowIso();
      await db
        .insert(threadSessions)
        .values({ threadId, botId, engineSessionId: sessionId, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: [threadSessions.threadId, threadSessions.botId],
          set: { engineSessionId: sessionId, updatedAt: timestamp },
        });
    },

    /**
     * Clears every engine session `botId` holds, in rooms and in its DMs, for example when the bot changes
     * engine: a session cannot resume on another engine. Rows stay with a null session, as after `set`.
     * Sessions already cleared are left alone, so their `updatedAt` does not move.
     */
    async clearBot(botId: string): Promise<void> {
      const timestamp = nowIso();
      await db.transaction(async (tx) => {
        await tx
          .update(threadSessions)
          .set({ engineSessionId: null, updatedAt: timestamp })
          .where(and(eq(threadSessions.botId, botId), isNotNull(threadSessions.engineSessionId)));
        await tx
          .update(threads)
          .set({ engineSessionId: null })
          .where(and(eq(threads.botId, botId), isNotNull(threads.engineSessionId)));
      });
    },
  };
}
