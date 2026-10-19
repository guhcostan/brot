import { and, desc, eq } from 'drizzle-orm';
import { ResolveApproval, type Approval, type ApprovalStatus } from '@brot/protocol';
import type { Db } from '../client';
import { approvals } from '../schema';
import { newId, nowIso, required } from './common';

type ApprovalRow = typeof approvals.$inferSelect;

export type CreateApprovalInput = Omit<Approval, 'id' | 'status' | 'createdAt'>;

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
