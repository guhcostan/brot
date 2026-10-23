import { and, desc, eq, sql } from 'drizzle-orm';
import type { MemoryAction, MemoryJournalEntry, MemoryKind, MemoryScope } from '@brot/protocol';
import type { Db } from '../client';
import { memoryJournal } from '../schema';
import { newId } from './common';

type MemoryJournalRow = typeof memoryJournal.$inferSelect;

export function toMemoryJournalEntry(row: MemoryJournalRow): MemoryJournalEntry {
  return {
    id: row.id,
    ...(row.memoryId === null ? {} : { memoryId: row.memoryId }),
    ...(row.botId === null ? {} : { botId: row.botId }),
    scope: row.scope,
    kind: row.kind,
    action: row.action,
    ...(row.contentBefore === null ? {} : { contentBefore: row.contentBefore }),
    ...(row.contentAfter === null ? {} : { contentAfter: row.contentAfter }),
    ...(row.sourceRunId === null ? {} : { sourceRunId: row.sourceRunId }),
    at: row.at,
  };
}

/** One journal row to write. The writer fills the nullable columns with null. */
export interface MemoryJournalWrite {
  memoryId?: string | null;
  botId?: string | null;
  scope: MemoryScope;
  kind: MemoryKind;
  action: MemoryAction;
  contentBefore?: string | null;
  contentAfter?: string | null;
  sourceRunId?: string | null;
  at: string;
}

/** The insert-capable handle a journal write needs: the database, or a transaction over it. */
export type JournalExecutor = Pick<Db, 'insert'>;

/** Appends one memory journal row. The caller owns the transaction, so a memory write and its history land together. */
export async function appendMemoryJournal(executor: JournalExecutor, write: MemoryJournalWrite): Promise<void> {
  await executor.insert(memoryJournal).values({
    id: newId(),
    memoryId: write.memoryId ?? null,
    botId: write.botId ?? null,
    scope: write.scope,
    kind: write.kind,
    action: write.action,
    contentBefore: write.contentBefore ?? null,
    contentAfter: write.contentAfter ?? null,
    sourceRunId: write.sourceRunId ?? null,
    at: write.at,
  });
}

export function createMemoryJournalRepo(db: Db) {
  return {
    /** Journal entries, newest first (rowid breaks ties within one millisecond). */
    async list(options: { botId?: string; scope?: MemoryScope; limit?: number } = {}): Promise<MemoryJournalEntry[]> {
      const rows = await db
        .select()
        .from(memoryJournal)
        .where(
          and(
            options.botId === undefined ? undefined : eq(memoryJournal.botId, options.botId),
            options.scope === undefined ? undefined : eq(memoryJournal.scope, options.scope),
          ),
        )
        .orderBy(desc(memoryJournal.at), desc(sql`rowid`))
        .limit(options.limit ?? 50);
      return rows.map(toMemoryJournalEntry);
    },

    async get(id: string): Promise<MemoryJournalEntry | undefined> {
      const [row] = await db.select().from(memoryJournal).where(eq(memoryJournal.id, id)).limit(1);
      return row ? toMemoryJournalEntry(row) : undefined;
    },
  };
}
