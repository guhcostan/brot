import type { Repos } from '@brot/db';
import { TodayQuery, type TodaySummary } from '@brot/protocol';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../auth';
import { buildHighlights } from './highlights';
import { countRoutineRuns, resolveTodayRange, serverTimeZone, summarizeRuns } from './summary';

export interface TodayRouteDeps {
  repos: Repos;
  /** Clock the default window reads. Tests inject a fixed time. */
  now?: () => Date;
  /** IANA zone the default window uses. Defaults to the process's zone. */
  serverTz?: string;
}

type TodayRequest =
  | { ok: true; from: string; to: string }
  | { ok: false; response: Response };

/** Mounts the read-only Today summary under `/api/*`, so device auth and CORS apply. */
export function mountTodayRoutes(app: Hono<AppEnv>, deps: TodayRouteDeps): void {
  const { repos } = deps;
  const clock = deps.now ?? (() => new Date());
  const defaultTimeZone = deps.serverTz ?? serverTimeZone();

  async function resolveRequest(c: Context<AppEnv>): Promise<TodayRequest> {
    const parsed = TodayQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return { ok: false, response: c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400) };
    }
    const resolution = resolveTodayRange(parsed.data, clock(), defaultTimeZone);
    if (!resolution.ok) {
      return {
        ok: false,
        response: c.json(
          { error: 'Invalid request', issues: [{ path: resolution.path, message: resolution.message }] },
          400,
        ),
      };
    }
    return { ok: true, from: resolution.range.from, to: resolution.range.to };
  }

  app.get('/api/today', async (c) => {
    const request = await resolveRequest(c);
    if (!request.ok) return request.response;
    const { from, to } = request;
    const [runs, bots, routineRuns, pendingApprovals] = await Promise.all([
      repos.runs.usage({ from, to }),
      repos.bots.list({ includeArchived: true }),
      repos.routineRuns.list(),
      repos.approvals.list({ status: 'pending' }),
    ]);
    const botNames = new Map(bots.map((bot) => [bot.id, bot.name]));
    const { totals, byBot } = summarizeRuns(runs, botNames);
    const routines = countRoutineRuns(routineRuns.filter((run) => run.startedAt >= from && run.startedAt < to));
    const highlights = await buildHighlights(
      repos,
      runs.filter((run) => run.status === 'completed'),
      botNames,
    );
    const summary: TodaySummary = { from, to, totals, byBot, routines, pendingApprovals: pendingApprovals.length, highlights };
    return c.json(summary);
  });
}
