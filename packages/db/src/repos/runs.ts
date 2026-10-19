import { asc, eq } from 'drizzle-orm';
import type { Run } from '@brot/protocol';
import type { Db } from '../client';
import { runs } from '../schema';
import { newId, nowIso, required } from './common';

type RunRow = typeof runs.$inferSelect;

export type RunPatch = Partial<Pick<Run, 'status' | 'engine' | 'model' | 'endedAt' | 'tokensIn' | 'tokensOut' | 'costUsd' | 'error'>>;

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    threadId: row.threadId,
    botId: row.botId,
    status: row.status,
    engine: row.engine,
    model: row.model ?? undefined,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    error: row.error ?? undefined,
  };
}

export function createRunRepo(db: Db) {
  return {
    async get(id: string): Promise<Run | undefined> {
      const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
      return row ? toRun(row) : undefined;
    },

    async listByThread(threadId: string): Promise<Run[]> {
      const rows = await db
        .select()
        .from(runs)
        .where(eq(runs.threadId, threadId))
        .orderBy(asc(runs.startedAt), asc(runs.id));
      return rows.map(toRun);
    },

    async create(input: { threadId: string; botId: string; engine: string; model?: string }): Promise<Run> {
      const [row] = await db
        .insert(runs)
        .values({
          id: newId(),
          threadId: input.threadId,
          botId: input.botId,
          status: 'running',
          engine: input.engine,
          model: input.model ?? null,
          startedAt: nowIso(),
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
        })
        .returning();
      return toRun(required(row, 'run'));
    },

    async update(id: string, patch: RunPatch): Promise<Run | undefined> {
      const rows = await db
        .update(runs)
        .set(patch)
        .where(eq(runs.id, id))
        .returning();
      return rows[0] ? toRun(rows[0]) : undefined;
    },
  };
}
