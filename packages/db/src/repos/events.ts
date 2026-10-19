import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { parseEvent, type CanonicalEvent } from '@brot/protocol';
import type { Db } from '../client';
import { events } from '../schema';

type EventRow = typeof events.$inferSelect;

const DEFAULT_LIMIT = 500;

function toEvent(row: EventRow): CanonicalEvent {
  return parseEvent({
    ...row.payload,
    id: row.id,
    type: row.type,
    at: row.at,
    threadId: row.threadId,
    runId: row.runId ?? undefined,
  });
}

/** Append-only event log. Rows are never updated or deleted except by cascade. */
export function createEventRepo(db: Db) {
  return {
    async append(input: CanonicalEvent): Promise<CanonicalEvent> {
      const event = parseEvent(input);
      const { id, type, at, threadId, runId, ...payload } = event;
      await db.insert(events).values({
        id,
        type,
        at,
        threadId,
        runId: runId ?? null,
        payload,
      });
      return event;
    },

    /** Events in log order. `after` is an ISO timestamp; only events strictly later are returned. */
    async list(options: { threadId?: string; after?: string; limit?: number } = {}): Promise<CanonicalEvent[]> {
      const rows = await db
        .select()
        .from(events)
        .where(
          and(
            options.threadId ? eq(events.threadId, options.threadId) : undefined,
            options.after ? gt(events.at, options.after) : undefined,
          ),
        )
        .orderBy(asc(events.at), asc(sql`rowid`))
        .limit(options.limit ?? DEFAULT_LIMIT);
      return rows.map(toEvent);
    },

    /**
     * Events of one thread after `afterEventId`, in log order, filtered in SQL. Returns undefined when that
     * event is not in the thread, so a caller can tell a stale cursor from an empty tail.
     */
    async listAfter(
      threadId: string,
      afterEventId: string,
      options: { limit?: number } = {},
    ): Promise<CanonicalEvent[] | undefined> {
      const [cursor] = await db
        .select({ at: events.at, rowid: sql<number>`rowid` })
        .from(events)
        .where(and(eq(events.id, afterEventId), eq(events.threadId, threadId)))
        .limit(1);
      if (!cursor) return undefined;

      const rows = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.threadId, threadId),
            or(gt(events.at, cursor.at), and(eq(events.at, cursor.at), gt(sql`rowid`, cursor.rowid))),
          ),
        )
        .orderBy(asc(events.at), asc(sql`rowid`))
        .limit(options.limit ?? DEFAULT_LIMIT);
      return rows.map(toEvent);
    },
  };
}
