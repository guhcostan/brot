import { z } from 'zod';
import { ApprovalDecision, ApprovalKind, IsoDateTime } from './entities';

/**
 * One resolved approval: the audit entry for a decision someone made. Only approvals with a decision are
 * decisions, so `decision` and `decidedAt` are always present. The approval's `args` are never part of it.
 */
export const Decision = z.object({
  /** The approval id. */
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  botId: z.string(),
  kind: ApprovalKind,
  tool: z.string(),
  summary: z.string(),
  decision: ApprovalDecision,
  reply: z.string().optional(),
  /** When the decision was recorded (`resolvedAt` on the approval). */
  decidedAt: IsoDateTime,
});
export type Decision = z.infer<typeof Decision>;

/**
 * The query behind `GET /api/decisions`: decisions whose `decidedAt` falls in the half-open range
 * [`from`, `to`). Both bounds default on the server (`to` = now, `from` = 30 days before it).
 */
export const DecisionQuery = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  botId: z.string().min(1).optional(),
  decision: ApprovalDecision.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type DecisionQuery = z.infer<typeof DecisionQuery>;
