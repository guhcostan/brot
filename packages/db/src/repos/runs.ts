import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { RunStatus, type Run } from '@brot/protocol';
import type { Db } from '../client';
import { runs } from '../schema';
import { newId, nowIso, required } from './common';

type RunRow = typeof runs.$inferSelect;

export type RunPatch = Partial<Pick<Run, 'status' | 'engine' | 'model' | 'endedAt' | 'tokensIn' | 'tokensOut' | 'costUsd' | 'error'>>;

/** Runs whose start time falls in [`from`, `to`), optionally narrowed to one bot. */
export interface RunUsageRange {
  from: string;
  to: string;
  botId?: string;
}

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

    /** Runs in a given status, oldest first. Used on startup to find runs that a restart left behind. */
    async listByStatus(status: RunStatus): Promise<Run[]> {
      const rows = await db
        .select()
        .from(runs)
        .where(eq(runs.status, RunStatus.parse(status)))
        .orderBy(asc(runs.startedAt), asc(runs.id));
      return rows.map(toRun);
    },

    async listByThread(threadId: string): Promise<Run[]> {
      const rows = await db
        .select()
        .from(runs)
        .where(eq(runs.threadId, threadId))
        .orderBy(asc(runs.startedAt), asc(runs.id));
      return rows.map(toRun);
    },

    /**
     * Runs started in the half-open range, oldest first, for the usage ledger. Bounds are normalized to ISO so
     * that the string comparison in the query matches the timestamps the harness stores. No aggregation here:
     * the server does that in memory, where it is easy to test and portable to another database.
     */
    async usage(range: RunUsageRange): Promise<Run[]> {
      const from = new Date(range.from).toISOString();
      const to = new Date(range.to).toISOString();
      const rows = await db
        .select()
        .from(runs)
        .where(
          and(
            gte(runs.startedAt, from),
            lt(runs.startedAt, to),
            range.botId === undefined ? undefined : eq(runs.botId, range.botId),
          ),
        )
        .orderBy(asc(runs.startedAt), asc(runs.id));
      return rows.map(toRun);
    },

    /**
     * Total cost of a bot's runs that started at or after `sinceIso`. One query, cheap enough for the daily
     * budget check at the start of every run; the bound is normalized to ISO to match the stored timestamps.
     */
    async costSince(botId: string, sinceIso: string): Promise<number> {
      const since = new Date(sinceIso).toISOString();
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${runs.costUsd}), 0)` })
        .from(runs)
        .where(and(eq(runs.botId, botId), gte(runs.startedAt, since)));
      return Number(row?.total ?? 0);
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
