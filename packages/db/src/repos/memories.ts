import { and, asc, eq, sql } from 'drizzle-orm';
import { CreateMemory, UpdateMemory, type CreateMemory as CreateMemoryBody, type Memory, type MemoryScope } from '@brot/protocol';
import type { Db } from '../client';
import { memories } from '../schema';
import { newId, nowIso, required } from './common';
import { appendMemoryJournal } from './memory-journal';

type MemoryRow = typeof memories.$inferSelect;

export function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    ...(row.botId === null ? {} : { botId: row.botId }),
    scope: row.scope,
    kind: row.kind,
    content: row.content,
    sourceRunId: row.sourceRunId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateMemoryInput extends CreateMemoryBody {
  /** Defaults to `bot`. */
  scope?: MemoryScope;
  /** The bot for a bot memory. Required there, refused for a workspace memory. */
  botId?: string;
  sourceRunId?: string;
}

export function createMemoryRepo(db: Db) {
  return {
    /** The memories a bot owns. Workspace memories are shared, so they are not included; see `listWorkspace`. */
    async listByBot(botId: string): Promise<Memory[]> {
      const rows = await db
        .select()
        .from(memories)
        .where(and(eq(memories.botId, botId), eq(memories.scope, 'bot')))
        .orderBy(asc(memories.createdAt), asc(sql`rowid`));
      return rows.map(toMemory);
    },

    /** Facts about the person, shared by every bot. Oldest first. */
    async listWorkspace(): Promise<Memory[]> {
      const rows = await db
        .select()
        .from(memories)
        .where(eq(memories.scope, 'workspace'))
        .orderBy(asc(memories.createdAt), asc(sql`rowid`));
      return rows.map(toMemory);
    },

    async get(id: string): Promise<Memory | undefined> {
      const [row] = await db.select().from(memories).where(eq(memories.id, id)).limit(1);
      return row ? toMemory(row) : undefined;
    },

    /**
     * Stores a bot memory (the `botId`, `input` form) or a workspace memory (the `{ scope: 'workspace', kind,
     * content }` form). A bot memory needs its bot; a workspace memory refuses one.
     */
    async create(
      first: string | CreateMemoryInput,
      second?: CreateMemoryBody & { sourceRunId?: string },
    ): Promise<Memory> {
      const data = CreateMemory.parse(typeof first === 'string' ? second : first);
      let scope: MemoryScope = 'bot';
      let owner: string | null;
      if (typeof first === 'string') {
        owner = first;
      } else {
        scope = first.scope ?? 'bot';
        owner = first.botId ?? null;
        if (scope === 'bot' && owner === null) throw new Error('a bot memory needs a botId');
        if (scope === 'workspace' && owner !== null) throw new Error('a workspace memory has no botId');
      }
      const sourceRunId = typeof first === 'string' ? second?.sourceRunId : first.sourceRunId;
      const timestamp = nowIso();
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(memories)
          .values({
            id: newId(),
            botId: owner,
            scope,
            kind: data.kind,
            content: data.content,
            sourceRunId: sourceRunId ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
        const created = toMemory(required(row, 'memory'));
        await appendMemoryJournal(tx, {
          memoryId: created.id,
          botId: created.botId ?? null,
          scope: created.scope,
          kind: created.kind,
          action: 'created',
          contentAfter: created.content,
          sourceRunId: created.sourceRunId ?? null,
          at: timestamp,
        });
        return created;
      });
    },

    async update(id: string, input: UpdateMemory): Promise<Memory | undefined> {
      const patch = UpdateMemory.parse(input);
      const timestamp = nowIso();
      return db.transaction(async (tx) => {
        const [before] = await tx.select().from(memories).where(eq(memories.id, id)).limit(1);
        if (before === undefined) return undefined;
        const [row] = await tx
          .update(memories)
          .set({ ...patch, updatedAt: timestamp })
          .where(eq(memories.id, id))
          .returning();
        const updated = toMemory(required(row, 'memory'));
        await appendMemoryJournal(tx, {
          memoryId: updated.id,
          botId: updated.botId ?? null,
          scope: updated.scope,
          kind: updated.kind,
          action: 'updated',
          contentBefore: before.content,
          contentAfter: updated.content,
          sourceRunId: before.sourceRunId ?? null,
          at: timestamp,
        });
        return updated;
      });
    },

    async remove(id: string): Promise<boolean> {
      const timestamp = nowIso();
      return db.transaction(async (tx) => {
        const [before] = await tx.select().from(memories).where(eq(memories.id, id)).limit(1);
        if (before === undefined) return false;
        const rows = await tx.delete(memories).where(eq(memories.id, id)).returning({ id: memories.id });
        if (rows.length === 0) return false;
        // The memory row is gone, so the deleted journal entry keeps the content and owner, not the id.
        await appendMemoryJournal(tx, {
          botId: before.botId,
          scope: before.scope,
          kind: before.kind,
          action: 'deleted',
          contentBefore: before.content,
          sourceRunId: before.sourceRunId,
          at: timestamp,
        });
        return true;
      });
    },
  };
}
