import type { Repos } from '@brot/db';
import { ImportTeamPackage, parseTeamPackage } from '@brot/protocol';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type { AppEnv } from '../auth';
import { TeamPackageExportError, exportTeamPackage } from './export';
import { importTeamPackage, packageRoutineIssues } from './import';

export interface TeamPackageRouteDeps {
  repos: Repos;
  /** Clock written to `exportedAt`. Tests inject a fixed time. */
  now?: () => Date;
}

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

async function parseBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<Parsed<T>> {
  const text = await c.req.text();
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      return { ok: false, response: c.json({ error: 'Request body must be valid JSON', issues: [] }, 400) };
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, response: c.json({ error: 'Invalid request', issues: result.error.issues }, 400) };
  return { ok: true, data: result.data };
}

/** Mounts the team package export/import routes under `/api/*`, so device auth and CORS apply. */
export function mountTeamPackageRoutes(app: Hono<AppEnv>, deps: TeamPackageRouteDeps): void {
  const { repos } = deps;

  app.get('/api/team-packages/export', async (c) => {
    const teamId = c.req.query('teamId');
    try {
      const exported = await exportTeamPackage(repos, {
        ...(teamId === undefined || teamId === '' ? {} : { teamId }),
        ...(deps.now === undefined ? {} : { now: deps.now }),
      });
      if (exported === undefined) return c.json({ error: 'Team not found' }, 404);
      return c.body(exported.markdown, 200, {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${exported.filename}"`,
      });
    } catch (error) {
      if (error instanceof TeamPackageExportError) return c.json({ error: error.message }, 400);
      throw error;
    }
  });

  app.post('/api/team-packages/import', async (c) => {
    const body = await parseBody(c, ImportTeamPackage);
    if (!body.ok) return body.response;
    const parsed = parseTeamPackage(body.data.content);
    if (!parsed.ok) return c.json({ error: 'Invalid team package', issues: parsed.issues }, 400);
    const routineIssues = packageRoutineIssues(parsed.package);
    if (routineIssues.length > 0) return c.json({ error: 'Invalid team package', issues: routineIssues }, 400);
    try {
      return c.json(await importTeamPackage(repos, parsed.package), 201);
    } catch (error) {
      console.error('team package import failed', error);
      return c.json({ error: 'The team package could not be imported; the partial import was rolled back.' }, 500);
    }
  });
}
