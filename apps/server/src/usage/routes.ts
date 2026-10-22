import type { Repos } from '@brot/db';
import { UsageRange } from '@brot/protocol';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../auth';
import { usageCsv, usageCsvFilename } from './csv';
import { resolveUsageRange, summarizeUsage, type ResolvedUsageRange } from './summary';

export interface UsageRouteDeps {
  repos: Repos;
  /** Clock the default range reads. Tests inject a fixed time. */
  now?: () => Date;
}

type ResolvedRequest = { ok: true; range: ResolvedUsageRange; botNames: Map<string, string> } | { ok: false; response: Response };

export function mountUsageRoutes(app: Hono<AppEnv>, deps: UsageRouteDeps): void {
  const { repos } = deps;
  const clock = deps.now ?? (() => new Date());

  /** Parses the query, applies the range defaults, and loads the bot names both routes need. */
  async function resolveRequest(c: Context<AppEnv>): Promise<ResolvedRequest> {
    const parsed = UsageRange.safeParse(c.req.query());
    if (!parsed.success) return { ok: false, response: c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400) };
    const resolution = resolveUsageRange(parsed.data, clock());
    if (!resolution.ok) {
      return {
        ok: false,
        response: c.json(
          { error: 'Invalid request', issues: [{ path: resolution.path, message: resolution.message }] },
          400,
        ),
      };
    }
    const bots = await repos.bots.list({ includeArchived: true });
    const botNames = new Map(bots.map((bot) => [bot.id, bot.name]));
    const botId = resolution.range.botId;
    if (botId !== undefined && !botNames.has(botId)) {
      return {
        ok: false,
        response: c.json(
          { error: 'Invalid request', issues: [{ path: ['botId'], message: `unknown bot ${botId}` }] },
          400,
        ),
      };
    }
    return { ok: true, range: resolution.range, botNames };
  }

  app.get('/api/usage', async (c) => {
    const request = await resolveRequest(c);
    if (!request.ok) return request.response;
    const runs = await repos.runs.usage(request.range);
    return c.json(summarizeUsage(runs, request.range, request.botNames));
  });

  app.get('/api/usage/export.csv', async (c) => {
    const request = await resolveRequest(c);
    if (!request.ok) return request.response;
    const runs = await repos.runs.usage(request.range);
    return c.body(usageCsv(runs, request.botNames), 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${usageCsvFilename(request.range.from, request.range.to)}"`,
    });
  });
}
