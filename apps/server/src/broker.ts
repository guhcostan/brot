import type { Repos } from '@brot/db';
import type { Approval, ApprovalDecision, Policy, ToolDecision, ToolRequest } from '@brot/protocol';
import type { EventBus } from './bus';

export type PolicyVerdict = 'allow' | 'deny' | 'ask';

export interface ApprovalScope {
  botId: string;
  threadId: string;
  runId: string;
}

export interface Broker {
  /** Applies the bot's policies. Returns 'ask' when no policy matches. */
  decide(botId: string, req: ToolRequest): Promise<PolicyVerdict>;
  /** Decides a tool request. On 'ask' the run is suspended until `resolve` is called for the approval. */
  request(scope: ApprovalScope, req: ToolRequest): Promise<ToolDecision>;
  resolve(approvalId: string, decision: ApprovalDecision, reply?: string): Promise<Approval | undefined>;
  /** Denies every approval still waiting on the run. */
  cancelRun(runId: string): Promise<void>;
}

interface Waiter {
  runId: string;
  settle: (decision: ToolDecision) => void;
}

/** A policy matches when its tool equals the request tool (or is '*') and its argPattern, if any, matches the JSON args. */
export function matchesPolicy(policy: Policy, req: Pick<ToolRequest, 'tool' | 'args'>): boolean {
  if (policy.tool !== '*' && policy.tool !== req.tool) return false;
  if (policy.argPattern === undefined) return true;
  try {
    return new RegExp(policy.argPattern).test(JSON.stringify(req.args));
  } catch {
    return false;
  }
}

/** Any matching deny wins over an allow. With no match the request needs a human decision. */
export function verdictFor(policies: Policy[], req: Pick<ToolRequest, 'tool' | 'args'>): PolicyVerdict {
  const matching = policies.filter((policy) => matchesPolicy(policy, req));
  if (matching.some((policy) => policy.effect === 'deny')) return 'deny';
  if (matching.some((policy) => policy.effect === 'allow')) return 'allow';
  return 'ask';
}

export function createBroker(deps: { repos: Repos; bus: EventBus }): Broker {
  const { repos, bus } = deps;
  const waiters = new Map<string, Waiter>();
  const settling = new Set<string>();

  async function decide(botId: string, req: ToolRequest): Promise<PolicyVerdict> {
    return verdictFor(await repos.policies.listByBot(botId), req);
  }

  async function request(scope: ApprovalScope, req: ToolRequest): Promise<ToolDecision> {
    const verdict = await decide(scope.botId, req);
    if (verdict === 'allow') return { allowed: true };
    if (verdict === 'deny') return { allowed: false, reply: 'Denied by policy.' };

    const approval = await repos.approvals.create({
      runId: scope.runId,
      threadId: scope.threadId,
      botId: scope.botId,
      kind: req.kind,
      tool: req.tool,
      summary: req.summary,
      args: req.args,
    });
    // Register the waiter before anything is published, so a fast resolve cannot miss it.
    const decision = new Promise<ToolDecision>((settle) => {
      waiters.set(approval.id, { runId: scope.runId, settle });
    });
    try {
      await repos.runs.update(scope.runId, { status: 'waiting_approval' });
      await bus.publish({ type: 'approval.requested', threadId: scope.threadId, runId: scope.runId, approval });
    } catch (error) {
      waiters.delete(approval.id);
      throw error;
    }
    return decision;
  }

  async function resolve(approvalId: string, decision: ApprovalDecision, reply?: string): Promise<Approval | undefined> {
    if (settling.has(approvalId)) return repos.approvals.get(approvalId);
    settling.add(approvalId);
    try {
      const current = await repos.approvals.get(approvalId);
      if (!current || current.status !== 'pending') return current;

      const resolved = await repos.approvals.resolve(approvalId, { decision, reply });
      if (!resolved) return undefined;

      const waiter = waiters.get(approvalId);
      waiters.delete(approvalId);
      try {
        if (decision === 'allow_always') {
          await repos.policies.create(resolved.botId, { tool: resolved.tool, effect: 'allow' });
        }
        await bus.publish({ type: 'approval.resolved', threadId: resolved.threadId, runId: resolved.runId, approval: resolved });
        // Restore 'running' before the waiter settles, so the engine cannot finish first and be overwritten.
        const run = await repos.runs.get(resolved.runId);
        if (run?.status === 'waiting_approval') {
          await repos.runs.update(resolved.runId, { status: 'running' });
        }
      } finally {
        // The approval is already recorded as resolved, so the engine must never be left waiting on it.
        waiter?.settle(
          decision === 'deny'
            ? { allowed: false, reply: reply ?? 'Denied by the user.' }
            : { allowed: true, reply },
        );
      }
      return resolved;
    } finally {
      settling.delete(approvalId);
    }
  }

  async function cancelRun(runId: string): Promise<void> {
    const pending = await repos.approvals.list({ status: 'pending' });
    for (const approval of pending) {
      if (approval.runId === runId) await resolve(approval.id, 'deny', 'Run cancelled.');
    }
  }

  return { decide, request, resolve, cancelRun };
}
