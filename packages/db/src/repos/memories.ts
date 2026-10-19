import { asc, eq } from 'drizzle-orm';
import { CreateMemory, UpdateMemory, type Memory } from '@brot/protocol';
import type { Db } from '../client';
import { memories } from '../schema';
import { newId, nowIso, required } from './common';

type MemoryRow = typeof memories.$inferSelect;

export function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    botId: row.botId,
    kind: row.kind,
    content: row.content,
    sourceRunId: row.sourceRunId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createMemoryRepo(db: Db) {
  return {
    async listByBot(botId: string): Promise<Memory[]> {
      const rows = await db
        .select()
        .from(memories)
        .where(eq(memories.botId, botId))
        .orderBy(asc(memories.createdAt), asc(memories.id));
      return rows.map(toMemory);
    },

    async get(id: string): Promise<Memory | undefined> {
      const [row] = await db.select().from(memories).where(eq(memories.id, id)).limit(1);
      return row ? toMemory(row) : undefined;
    },

    async create(botId: string, input: CreateMemory & { sourceRunId?: string }): Promise<Memory> {
      const data = CreateMemory.parse(input);
      const timestamp = nowIso();
      const sourceRunId = input.sourceRunId ?? null;
      const [row] = await db
        .insert(memories)
        .values({
          id: newId(),
          botId,
          kind: data.kind,
          content: data.content,
          sourceRunId,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toMemory(required(row, 'memory'));
    },

    async update(id: string, input: UpdateMemory): Promise<Memory | undefined> {
      const patch = UpdateMemory.parse(input);
      const rows = await db
        .update(memories)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(memories.id, id))
        .returning();
      return rows[0] ? toMemory(rows[0]) : undefined;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(memories).where(eq(memories.id, id)).returning({ id: memories.id });
      return rows.length > 0;
    },
  };
}
