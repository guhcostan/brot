import { and, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { threadSessions } from '../schema';
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
  };
}
