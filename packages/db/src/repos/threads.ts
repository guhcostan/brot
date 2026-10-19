import { and, asc, desc, eq } from 'drizzle-orm';
import { CreateThread, type Thread, type ThreadKind } from '@brot/protocol';
import type { Db } from '../client';
import { threads } from '../schema';
import { newId, nowIso, required } from './common';

type ThreadRow = typeof threads.$inferSelect;

export function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    botId: row.botId,
    title: row.title,
    kind: row.kind,
    leadBotId: row.leadBotId ?? undefined,
    responder: row.responder ?? undefined,
    engineSessionId: row.engineSessionId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createThreadRepo(db: Db) {
  return {
    /**
     * Threads whose `botId` is this bot. For a room that is the lead bot, so pass `kind: 'dm'` to list
     * only the bot's DMs.
     */
    async listByBot(botId: string, options: { kind?: ThreadKind } = {}): Promise<Thread[]> {
      const rows = await db
        .select()
        .from(threads)
        .where(and(eq(threads.botId, botId), options.kind ? eq(threads.kind, options.kind) : undefined))
        .orderBy(desc(threads.updatedAt), asc(threads.id));
      return rows.map(toThread);
    },

    /** Every room thread, most recently updated first. */
    async listRooms(): Promise<Thread[]> {
      const rows = await db
        .select()
        .from(threads)
        .where(eq(threads.kind, 'room'))
        .orderBy(desc(threads.updatedAt), asc(threads.id));
      return rows.map(toThread);
    },

    async get(id: string): Promise<Thread | undefined> {
      const [row] = await db.select().from(threads).where(eq(threads.id, id)).limit(1);
      return row ? toThread(row) : undefined;
    },

    async create(botId: string, input: { title?: string } = {}): Promise<Thread> {
      const data = CreateThread.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(threads)
        .values({
          id: newId(),
          botId,
          title: data.title ?? 'New thread',
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toThread(required(row, 'thread'));
    },

    /**
     * Stores the engine session to resume, or clears it with null. Does not change `updatedAt`:
     * the session id is internal bookkeeping, not thread activity.
     */
    async setEngineSessionId(id: string, engineSessionId: string | null): Promise<Thread | undefined> {
      const rows = await db
        .update(threads)
        .set({ engineSessionId })
        .where(eq(threads.id, id))
        .returning();
      return rows[0] ? toThread(rows[0]) : undefined;
    },

    async touch(id: string): Promise<Thread | undefined> {
      const rows = await db
        .update(threads)
        .set({ updatedAt: nowIso() })
        .where(eq(threads.id, id))
        .returning();
      return rows[0] ? toThread(rows[0]) : undefined;
    },
  };
}
