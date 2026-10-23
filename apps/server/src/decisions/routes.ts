import type { Repos } from '@brot/db';
import { DecisionQuery, type Approval, type Decision } from '@brot/protocol';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../auth';
import { decisionsCsv, decisionsCsvFilename } from './csv';
import { toDecision } from './decision';
import { resolveDecisionRange, type ResolvedDecisionRange } from './query';

export interface DecisionRouteDeps {
  repos: Repos;
  /** Clock the default range reads. Tests inject a fixed time. */
  now?: () => Date;
}

type ResolvedRequest = { ok: true; range: ResolvedDecisionRange } | { ok: false; response: Response };

/** Mounts the approval decision log and its CSV export under `/api`, so device auth applies. */
export function mountDecisionRoutes(app: Hono<AppEnv>, deps: DecisionRouteDeps): void {
  const { repos } = deps;
  const clock = deps.now ?? (() => new Date());

  async function resolveRequest(c: Context<AppEnv>): Promise<ResolvedRequest> {
    const parsed = DecisionQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return { ok: false, response: c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400) };
    }
    const resolution = resolveDecisionRange(parsed.data, clock());
    if (!resolution.ok) {
      return {
        ok: false,
        response: c.json(
          { error: 'Invalid request', issues: [{ path: resolution.path, message: resolution.message }] },
          400,
        ),
      };
    }
    if (resolution.range.botId !== undefined && !(await repos.bots.get(resolution.range.botId))) {
      return {
        ok: false,
        response: c.json(
          {
            error: 'Invalid request',
            issues: [{ path: ['botId'], message: `unknown bot ${resolution.range.botId}` }],
          },
          400,
        ),
      };
    }
    return { ok: true, range: resolution.range };
  }

  function decisionsOf(rows: readonly Approval[]): Decision[] {
    return rows.map(toDecision).filter((decision): decision is Decision => decision !== undefined);
  }

  app.get('/api/decisions', async (c) => {
    const request = await resolveRequest(c);
    if (!request.ok) return request.response;
    const { from, to, botId, decision, limit } = request.range;
    const rows = await repos.approvals.listDecisions({
      from,
      to,
      ...(botId === undefined ? {} : { botId }),
      ...(decision === undefined ? {} : { decision }),
      limit,
    });
    return c.json(decisionsOf(rows));
  });

  app.get('/api/decisions/export.csv', async (c) => {
    const request = await resolveRequest(c);
    if (!request.ok) return request.response;
    const { from, to, botId, decision } = request.range;
    // The export is the whole matching log, not one page.
    const rows = await repos.approvals.listDecisions({
      from,
      to,
      ...(botId === undefined ? {} : { botId }),
      ...(decision === undefined ? {} : { decision }),
    });
    return c.body(decisionsCsv(decisionsOf(rows)), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${decisionsCsvFilename(from, to)}"`,
      'cache-control': 'no-store',
    });
  });
}
