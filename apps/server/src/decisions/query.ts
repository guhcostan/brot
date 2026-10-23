import type { ApprovalDecision, DecisionQuery } from '@brot/protocol';

/** Days of history the decisions endpoints cover when the query names no range, like usage. */
export const DEFAULT_DECISION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A decision query after defaults are applied. `from` is inclusive and `to` exclusive; both are ISO in UTC. */
export interface ResolvedDecisionRange {
  from: string;
  to: string;
  botId?: string;
  decision?: ApprovalDecision;
  limit: number;
}

export type DecisionRangeResolution =
  | { ok: true; range: ResolvedDecisionRange }
  | { ok: false; path: string[]; message: string };

/**
 * Resolves a decision query: `to` defaults to `now` and `from` to 30 days before the resolved `to`. An explicit
 * bound is normalized to `toISOString()`, which is the form stored on approvals and therefore compares exactly.
 */
export function resolveDecisionRange(query: DecisionQuery, now: Date): DecisionRangeResolution {
  const to = query.to === undefined ? now.toISOString() : new Date(query.to).toISOString();
  const from =
    query.from === undefined
      ? new Date(Date.parse(to) - DEFAULT_DECISION_DAYS * DAY_MS).toISOString()
      : new Date(query.from).toISOString();
  if (Date.parse(from) > Date.parse(to)) {
    return { ok: false, path: ['from'], message: 'from must not be after to' };
  }
  return {
    ok: true,
    range: {
      from,
      to,
      ...(query.botId === undefined ? {} : { botId: query.botId }),
      ...(query.decision === undefined ? {} : { decision: query.decision }),
      limit: query.limit,
    },
  };
}
