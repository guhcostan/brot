import { and, desc, eq, inArray } from 'drizzle-orm';
import type { IsoDateTime, RoutineRun, RoutineRunStatus, RoutineRunTrigger } from '@brot/protocol';
import type { Db } from '../client';
import { routineRuns } from '../schema';
import { newId, nowIso, required } from './common';

type RoutineRunRow = typeof routineRuns.$inferSelect;

/** Statuses that hold the routine's overlap guard. */
const ACTIVE_STATUSES: readonly RoutineRunStatus[] = ['queued', 'running'];

export interface CreateRoutineRunInput {
  routineId: string;
  botId: string;
  threadId: string;
  trigger: RoutineRunTrigger;
  /** Defaults to `running`: the scheduler writes a row once it starts the run. */
  status?: RoutineRunStatus;
  runId?: string;
  result?: string;
  error?: string;
  startedAt?: IsoDateTime;
  endedAt?: IsoDateTime;
}

export type RoutineRunPatch = Partial<
  Pick<RoutineRun, 'runId' | 'status' | 'result' | 'error' | 'startedAt' | 'endedAt'>
>;

export interface RoutineRunFilter {
  routineId?: string;
  botId?: string;
  status?: RoutineRunStatus;
  /** Omitted: every match. */
  limit?: number;
}

export function toRoutineRun(row: RoutineRunRow): RoutineRun {
  return {
    id: row.id,
    routineId: row.routineId,
    botId: row.botId,
    threadId: row.threadId,
    runId: row.runId ?? undefined,
    trigger: row.trigger,
    status: row.status,
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

export function createRoutineRunRepo(db: Db) {
  async function list(filter: RoutineRunFilter): Promise<RoutineRun[]> {
    const matching = db
      .select()
      .from(routineRuns)
      .where(
        and(
          filter.routineId === undefined ? undefined : eq(routineRuns.routineId, filter.routineId),
          filter.botId === undefined ? undefined : eq(routineRuns.botId, filter.botId),
          filter.status === undefined ? undefined : eq(routineRuns.status, filter.status),
        ),
      )
      .orderBy(desc(routineRuns.startedAt), desc(routineRuns.id));
    const rows = filter.limit === undefined ? await matching : await matching.limit(filter.limit);
    return rows.map(toRoutineRun);
  }

  return {
    async create(input: CreateRoutineRunInput): Promise<RoutineRun> {
      const timestamp = nowIso();
      const [row] = await db
        .insert(routineRuns)
        .values({
          id: newId(),
          routineId: input.routineId,
          botId: input.botId,
          threadId: input.threadId,
          runId: input.runId ?? null,
          trigger: input.trigger,
          status: input.status ?? 'running',
          result: input.result ?? null,
          error: input.error ?? null,
          startedAt: input.startedAt ?? timestamp,
          endedAt: input.endedAt ?? null,
          createdAt: timestamp,
        })
        .returning();
      return toRoutineRun(required(row, 'routine run'));
    },

    async update(id: string, patch: RoutineRunPatch): Promise<RoutineRun | undefined> {
      const rows = await db.update(routineRuns).set(patch).where(eq(routineRuns.id, id)).returning();
      return rows[0] ? toRoutineRun(rows[0]) : undefined;
    },

    async get(id: string): Promise<RoutineRun | undefined> {
      const [row] = await db.select().from(routineRuns).where(eq(routineRuns.id, id)).limit(1);
      return row ? toRoutineRun(row) : undefined;
    },

    /** Runs matching every given filter, newest first. */
    list(filter: RoutineRunFilter = {}): Promise<RoutineRun[]> {
      return list(filter);
    },

    /** A routine's runs, newest first. */
    listByRoutine(routineId: string, options: { limit?: number } = {}): Promise<RoutineRun[]> {
      return list(options.limit === undefined ? { routineId } : { routineId, limit: options.limit });
    },

    /** The runs still holding the routine's overlap guard: queued or running, newest first. */
    async activeByRoutine(routineId: string): Promise<RoutineRun[]> {
      const rows = await db
        .select()
        .from(routineRuns)
        .where(and(eq(routineRuns.routineId, routineId), inArray(routineRuns.status, ACTIVE_STATUSES)))
        .orderBy(desc(routineRuns.startedAt), desc(routineRuns.id));
      return rows.map(toRoutineRun);
    },

    /** The latest run that completed, for `rememberLastRun`. */
    async latestCompleted(routineId: string): Promise<RoutineRun | undefined> {
      const [row] = await db
        .select()
        .from(routineRuns)
        .where(and(eq(routineRuns.routineId, routineId), eq(routineRuns.status, 'completed')))
        .orderBy(desc(routineRuns.startedAt), desc(routineRuns.id))
        .limit(1);
      return row ? toRoutineRun(row) : undefined;
    },
  };
}
