import type { Approval, Decision } from '@brot/protocol';

/**
 * The audit view of a resolved approval. Absent when the row somehow lacks a decision or a resolution time;
 * `repos.approvals.listDecisions` already filters those out.
 */
export function toDecision(approval: Approval): Decision | undefined {
  if (approval.decision === undefined || approval.resolvedAt === undefined) return undefined;
  return {
    id: approval.id,
    runId: approval.runId,
    threadId: approval.threadId,
    botId: approval.botId,
    kind: approval.kind,
    tool: approval.tool,
    summary: approval.summary,
    decision: approval.decision,
    ...(approval.reply === undefined ? {} : { reply: approval.reply }),
    decidedAt: approval.resolvedAt,
  };
}
