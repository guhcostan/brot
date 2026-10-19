import { and, asc, eq, sql } from 'drizzle-orm';
import {
  CreateRoutine,
  UpdateRoutine,
  type CreateRoutineInput,
  type IsoDateTime,
  type Routine,
} from '@brot/protocol';
import type { Db } from '../client';
import { routines } from '../schema';
import { newId, nowIso, required } from './common';

type RoutineRow = typeof routines.$inferSelect;

/** Scheduler-owned fields, written alongside the user-editable ones. */
export interface RoutineScheduleUpdate {
  lastRunAt?: IsoDateTime;
  nextRunAt?: IsoDateTime;
}

export function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    botId: row.botId,
    name: row.name,
    instruction: row.instruction,
    trigger: row.trigger,
    enabled: row.enabled,
    lastRunAt: row.lastRunAt ?? undefined,
    nextRunAt: row.nextRunAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createRoutineRepo(db: Db) {
  return {
    async list(options: { botId?: string } = {}): Promise<Routine[]> {
      const rows = await db
        .select()
        .from(routines)
        .where(options.botId ? eq(routines.botId, options.botId) : undefined)
        .orderBy(asc(routines.createdAt), asc(routines.id));
      return rows.map(toRoutine);
    },

    async get(id: string): Promise<Routine | undefined> {
      const [row] = await db.select().from(routines).where(eq(routines.id, id)).limit(1);
      return row ? toRoutine(row) : undefined;
    },

    async create(input: CreateRoutineInput): Promise<Routine> {
      const data = CreateRoutine.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(routines)
        .values({
          id: newId(),
          botId: data.botId,
          name: data.name,
          instruction: data.instruction,
          trigger: data.trigger,
          enabled: data.enabled,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toRoutine(required(row, 'routine'));
    },

    async update(id: string, input: UpdateRoutine & RoutineScheduleUpdate): Promise<Routine | undefined> {
      const { lastRunAt, nextRunAt, ...editable } = input;
      const patch = UpdateRoutine.parse(editable);
      const rows = await db
        .update(routines)
        .set({ ...patch, lastRunAt, nextRunAt, updatedAt: nowIso() })
        .where(eq(routines.id, id))
        .returning();
      return rows[0] ? toRoutine(rows[0]) : undefined;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(routines).where(eq(routines.id, id)).returning({ id: routines.id });
      return rows.length > 0;
    },

    /**
     * Finds the routine whose webhook trigger carries this secret. Returns it even when disabled;
     * the caller decides whether to fire it.
     */
    async findByWebhookSecret(secret: string): Promise<Routine | undefined> {
      const [row] = await db
        .select()
        .from(routines)
        .where(
          and(
            sql`json_extract(${routines.trigger}, '$.type') = 'webhook'`,
            sql`json_extract(${routines.trigger}, '$.secret') = ${secret}`,
          ),
        )
        .limit(1);
      return row ? toRoutine(row) : undefined;
    },
  };
}
