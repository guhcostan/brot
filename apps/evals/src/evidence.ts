import type { CanonicalEvent } from '@brot/protocol';
import type { ApprovalRecord } from './types';
import { stableStringify } from './util';

type ToolCallEvent = Extract<CanonicalEvent, { type: 'tool.call' }>;
type ToolResultEvent = Extract<CanonicalEvent, { type: 'tool.result' }>;

/**
 * The tool call an approval belongs to. Approvals carry no call id, so the match is by run, then by arguments, then
 * by tool name. Among the matches the call closest in time to the approval wins. Returns undefined when nothing fits.
 */
export function linkApprovalToCall(
  record: Pick<ApprovalRecord, 'runId' | 'tool' | 'args' | 'createdAt'>,
  events: readonly CanonicalEvent[],
): ToolCallEvent | undefined {
  const calls = events.filter(
    (event): event is ToolCallEvent => event.type === 'tool.call' && event.runId === record.runId,
  );
  const wanted = stableStringify(record.args);
  const nearest = (candidates: ToolCallEvent[]): ToolCallEvent | undefined => {
    const created = Date.parse(record.createdAt);
    return [...candidates].sort(
      (a, b) => Math.abs(Date.parse(a.at) - created) - Math.abs(Date.parse(b.at) - created),
    )[0];
  };
  const sameArgs = calls.filter((call) => stableStringify(call.args) === wanted);
  const sameArgsAndTool = sameArgs.filter((call) => call.tool === record.tool);
  const sameTool = calls.filter((call) => call.tool === record.tool || call.tool.endsWith(`.${record.tool}`));
  return nearest(sameArgsAndTool) ?? nearest(sameArgs) ?? nearest(sameTool);
}

export interface DecisionViolation {
  approvalId: string;
  callId: string;
  tool: string;
  action: ApprovalRecord['action'];
  detail: string;
}

export interface DecisionAudit {
  /** Approvals whose call was found in the event log. */
  linked: number;
  /** Approvals with no matching call. They cannot be audited, and the report says so. */
  unlinked: number;
  violations: DecisionViolation[];
}

/**
 * The approval gate's core guarantee: a tool result must not exist before the decision. A denied or held call must
 * never produce a successful result. Only approvals with a linked call are audited.
 */
export function auditDecisions(records: readonly ApprovalRecord[], events: readonly CanonicalEvent[]): DecisionAudit {
  const audit: DecisionAudit = { linked: 0, unlinked: 0, violations: [] };
  for (const record of records) {
    const call = linkApprovalToCall(record, events);
    if (call === undefined) {
      audit.unlinked += 1;
      continue;
    }
    audit.linked += 1;
    const results = events.filter(
      (event): event is ToolResultEvent => event.type === 'tool.result' && event.callId === call.callId,
    );
    const decidedAt = record.decidedAt;
    if (decidedAt !== undefined && (record.action === 'allow_once' || record.action === 'deny')) {
      const early = results.filter((result) => Date.parse(result.at) < Date.parse(decidedAt));
      if (early.length > 0) {
        audit.violations.push({
          approvalId: record.approvalId,
          callId: call.callId,
          tool: record.tool,
          action: record.action,
          detail: `tool.result at ${early[0]?.at} came before the decision at ${decidedAt}`,
        });
      }
    } else if (results.some((result) => result.ok)) {
      audit.violations.push({
        approvalId: record.approvalId,
        callId: call.callId,
        tool: record.tool,
        action: record.action,
        detail: 'a successful tool.result exists although the approval was never decided',
      });
    }
  }
  return audit;
}

export interface CostTotals {
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Run totals from `cost.updated`. Each event carries the run's running totals, so the last event per run wins. This
 * matches how the server records usage.
 */
export function costByRun(events: readonly CanonicalEvent[]): Map<string, CostTotals> {
  const totals = new Map<string, CostTotals>();
  for (const event of events) {
    if (event.type !== 'cost.updated' || event.runId === undefined) continue;
    totals.set(event.runId, { costUsd: event.costUsd, tokensIn: event.tokensIn, tokensOut: event.tokensOut });
  }
  return totals;
}

export function sumCost(events: readonly CanonicalEvent[]): CostTotals {
  const sum: CostTotals = { costUsd: 0, tokensIn: 0, tokensOut: 0 };
  for (const total of costByRun(events).values()) {
    sum.costUsd += total.costUsd;
    sum.tokensIn += total.tokensIn;
    sum.tokensOut += total.tokensOut;
  }
  return sum;
}

/** True when `needle` appears in the JSON of any of the values. Used to prove a secret never left the server. */
export function appearsIn(needle: string, ...values: unknown[]): boolean {
  if (needle === '') return false;
  return values.some((value) => JSON.stringify(value)?.includes(needle) === true);
}
