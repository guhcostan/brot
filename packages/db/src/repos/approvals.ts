import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { ResolveApproval, type Approval, type ApprovalDecision, type ApprovalStatus } from '@brot/protocol';
import type { Db } from '../client';
import { approvals } from '../schema';
import { newId, nowIso, required } from './common';

type ApprovalRow = typeof approvals.$inferSelect;

export type CreateApprovalInput = Omit<Approval, 'id' | 'status' | 'createdAt'>;

/** Statuses a decision has: an approval that was allowed or denied. */
const RESOLVED_STATUSES: readonly ApprovalStatus[] = ['allowed', 'denied'];

/** The most decisions one `listDecisions` call returns when it passes a limit. */
export const DECISION_LIMIT_MAX = 200;

/** A decision-log query: resolved approvals whose `resolvedAt` falls in [`from`, `to`). */
export interface DecisionFilter {
  from?: string;
  to?: string;
  botId?: string;
  decision?: ApprovalDecision;
  /** Rows to return, capped at `DECISION_LIMIT_MAX`. Omitted: every matching row (the CSV export reads all). */
  limit?: number;
}

export function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    runId: row.runId,
    threadId: row.threadId,
    botId: row.botId,
    kind: row.kind,
    tool: row.tool,
    summary: row.summary,
    args: row.args,
    status: row.status,
    decision: row.decision ?? undefined,
    reply: row.reply ?? undefined,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? undefined,
  };
}

export function createApprovalRepo(db: Db) {
  const get = async (id: string): Promise<Approval | undefined> => {
    const [row] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
    return row ? toApproval(row) : undefined;
  };

  return {
    get,

    async list(options: { status?: ApprovalStatus } = {}): Promise<Approval[]> {
      const rows = await db
        .select()
        .from(approvals)
        .where(options.status ? eq(approvals.status, options.status) : undefined)
        .orderBy(desc(approvals.createdAt));
      return rows.map(toApproval);
    },

    /** Approvals still waiting for a person, newest first. */
    async listPending(): Promise<Approval[]> {
      const rows = await db
        .select()
        .from(approvals)
        .where(eq(approvals.status, 'pending'))
        .orderBy(desc(approvals.createdAt), desc(sql`rowid`));
      return rows.map(toApproval);
    },

    /**
     * Expires a pending approval: status `expired`, resolved now, and no decision (expiring is not a person's
     * decision). `reply` fills the reply only when there is none; an existing reply is kept. Returns undefined
     * when the approval is unknown or no longer pending.
     */
    async expire(id: string, reply?: string): Promise<Approval | undefined> {
      const rows = await db
        .update(approvals)
        .set({
          status: 'expired',
          resolvedAt: nowIso(),
          ...(reply === undefined || reply === ''
            ? {}
            : { reply: sql`coalesce(nullif(${approvals.reply}, ''), ${reply})` }),
        })
        .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
        .returning();
      return rows[0] ? toApproval(rows[0]) : undefined;
    },

    /**
     * The decision log: approvals that were allowed or denied, newest first by `resolvedAt`. Pending ones and
     * rows without a decision or a resolution time are never returned. The limit is applied in SQL.
     */
    async listDecisions(filter: DecisionFilter = {}): Promise<Approval[]> {
      const conditions = [
        inArray(approvals.status, [...RESOLVED_STATUSES]),
        isNotNull(approvals.decision),
        isNotNull(approvals.resolvedAt),
        ...(filter.from === undefined ? [] : [gte(approvals.resolvedAt, filter.from)]),
        ...(filter.to === undefined ? [] : [lt(approvals.resolvedAt, filter.to)]),
        ...(filter.botId === undefined ? [] : [eq(approvals.botId, filter.botId)]),
        ...(filter.decision === undefined ? [] : [eq(approvals.decision, filter.decision)]),
      ];
      const query = db
        .select()
        .from(approvals)
        .where(and(...conditions))
        .orderBy(desc(approvals.resolvedAt), desc(sql`rowid`));
      const rows =
        filter.limit === undefined
          ? await query
          : await query.limit(Math.min(Math.max(1, filter.limit), DECISION_LIMIT_MAX));
      return rows.map(toApproval);
    },

    async create(input: CreateApprovalInput): Promise<Approval> {
      const [row] = await db
        .insert(approvals)
        .values({
          id: newId(),
          runId: input.runId,
          threadId: input.threadId,
          botId: input.botId,
          kind: input.kind,
          tool: input.tool,
          summary: input.summary,
          args: input.args,
          status: 'pending',
          createdAt: nowIso(),
        })
        .returning();
      return toApproval(required(row, 'approval'));
    },

    /**
     * Records the decision on a pending approval. Only the first decision wins: resolving an
     * approval that is already allowed or denied returns it unchanged.
     */
    async resolve(id: string, input: ResolveApproval): Promise<Approval | undefined> {
      const decision = ResolveApproval.parse(input);
      const rows = await db
        .update(approvals)
        .set({
          status: decision.decision === 'deny' ? 'denied' : 'allowed',
          decision: decision.decision,
          reply: decision.reply ?? null,
          resolvedAt: nowIso(),
        })
        .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
        .returning();
      return rows[0] ? toApproval(rows[0]) : get(id);
    },
  };
}
