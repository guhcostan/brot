import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { IsoDateTime, Notification, NotificationKind } from '@brot/protocol';
import type { Db } from '../client';
import { notifications } from '../schema';
import { newId, nowIso, required } from './common';

type NotificationRow = typeof notifications.$inferSelect;

/** How many notifications a listing returns unless it asks for another size, and the most it may return. */
export const NOTIFICATION_LIST_DEFAULT = 50;
export const NOTIFICATION_LIST_MAX = 200;

export interface CreateNotificationInput {
  botId: string;
  threadId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Defaults to now. Tests and backfills set it to place a record in the past. */
  createdAt?: IsoDateTime;
}

export interface NotificationFilter {
  /** Only unread ones. */
  unread?: boolean;
  botId?: string;
  /** Defaults to `NOTIFICATION_LIST_DEFAULT`, capped at `NOTIFICATION_LIST_MAX`. */
  limit?: number;
}

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    botId: row.botId,
    threadId: row.threadId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    readAt: row.readAt ?? undefined,
  };
}

export function createNotificationRepo(db: Db) {
  return {
    async create(input: CreateNotificationInput): Promise<Notification> {
      const [row] = await db
        .insert(notifications)
        .values({
          id: newId(),
          botId: input.botId,
          threadId: input.threadId,
          kind: input.kind,
          title: input.title,
          body: input.body,
          createdAt: input.createdAt ?? nowIso(),
          readAt: null,
        })
        .returning();
      return toNotification(required(row, 'notification'));
    },

    /** Newest first. Unread and bot filters are ANDed; the limit is clamped to the max. */
    async list(options: NotificationFilter = {}): Promise<Notification[]> {
      const conditions = [
        ...(options.unread === true ? [isNull(notifications.readAt)] : []),
        ...(options.botId === undefined ? [] : [eq(notifications.botId, options.botId)]),
      ];
      const requested = options.limit ?? NOTIFICATION_LIST_DEFAULT;
      const limit = Math.min(Math.max(1, requested), NOTIFICATION_LIST_MAX);
      const rows = await db
        .select()
        .from(notifications)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(sql`rowid`))
        .limit(limit);
      return rows.map(toNotification);
    },

    async countUnread(): Promise<number> {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(isNull(notifications.readAt));
      return Number(row?.count ?? 0);
    },

    /**
     * Marks unread notifications read and returns how many changed. With no ids, marks every unread one;
     * an empty id list marks none.
     */
    async markRead(ids?: readonly string[]): Promise<number> {
      if (ids !== undefined && ids.length === 0) return 0;
      const conditions = [
        isNull(notifications.readAt),
        ...(ids === undefined ? [] : [inArray(notifications.id, [...ids])]),
      ];
      const rows = await db
        .update(notifications)
        .set({ readAt: nowIso() })
        .where(and(...conditions))
        .returning({ id: notifications.id });
      return rows.length;
    },

    /** Deletes one notification. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(notifications).where(eq(notifications.id, id)).returning({ id: notifications.id });
      return rows.length > 0;
    },

    /** Deletes notifications created before `iso`. Returns how many were removed. */
    async pruneBefore(iso: IsoDateTime): Promise<number> {
      const rows = await db.delete(notifications).where(lt(notifications.createdAt, iso)).returning({ id: notifications.id });
      return rows.length;
    },

    /** Every stored id, oldest first. Used by tests to inspect ordering. */
    async listIds(): Promise<string[]> {
      const rows = await db.select({ id: notifications.id }).from(notifications).orderBy(asc(notifications.createdAt));
      return rows.map((row) => row.id);
    },
  };
}
