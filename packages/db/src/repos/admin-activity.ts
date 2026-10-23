import { desc, sql } from 'drizzle-orm';
import type { AdminAction, AdminActivity } from '@brot/protocol';
import type { Db } from '../client';
import { adminActivity } from '../schema';
import { newId, nowIso, required } from './common';

type AdminActivityRow = typeof adminActivity.$inferSelect;

/** Most entries one list call returns. */
export const ADMIN_ACTIVITY_LIMIT_DEFAULT = 50;
export const ADMIN_ACTIVITY_LIMIT_MAX = 200;

export function toAdminActivity(row: AdminActivityRow): AdminActivity {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    ...(row.targetId === null ? {} : { targetId: row.targetId }),
    summary: row.summary,
    actor: row.actor,
    at: row.at,
  };
}

export interface RecordAdminActivityInput {
  action: AdminAction;
  targetType: string;
  targetId?: string;
  summary: string;
  actor: string;
}

export function createAdminActivityRepo(db: Db) {
  return {
    /** Appends one entry. `id` and `at` are generated here; summaries are clipped to the protocol's 300 chars. */
    async record(input: RecordAdminActivityInput): Promise<AdminActivity> {
      const [row] = await db
        .insert(adminActivity)
        .values({
          id: newId(),
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          summary: input.summary.slice(0, 300),
          actor: input.actor,
          at: nowIso(),
        })
        .returning();
      return toAdminActivity(required(row, 'admin activity'));
    },

    /** The log, newest first; rowid breaks ties within one millisecond. */
    async list(options: { limit?: number } = {}): Promise<AdminActivity[]> {
      const limit = Math.min(Math.max(1, options.limit ?? ADMIN_ACTIVITY_LIMIT_DEFAULT), ADMIN_ACTIVITY_LIMIT_MAX);
      const rows = await db
        .select()
        .from(adminActivity)
        .orderBy(desc(adminActivity.at), desc(sql`rowid`))
        .limit(limit);
      return rows.map(toAdminActivity);
    },
  };
}
