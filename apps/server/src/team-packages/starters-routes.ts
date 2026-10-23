import type { Repos } from '@brot/db';
import { TeamPackage } from '@brot/protocol';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../auth';
import { importTeamPackage, packageRoutineIssues } from './import';
import { STARTER_TEAMS, starterTeamById, starterTeamPackage, starterTeamSummary } from './starters';

/** The admin activity entry an install records. The app supplies the actor through its recorder. */
export interface StarterInstallEntry {
  action: 'created';
  targetType: 'team-package';
  targetId: string;
  summary: string;
}

export interface StarterTeamRouteDeps {
  repos: Repos;
  /** Clock written to the served package's `exportedAt`. Tests inject a fixed time. */
  now?: () => Date;
  /** Best-effort admin activity hook; the app passes its actor-aware recorder. */
  record?(c: Context<AppEnv>, entry: StarterInstallEntry): Promise<void>;
}

/**
 * Mounts the starter-team library under `/api/*`: the static list and the install route. An install runs the
 * normal team-package importer, so it creates ordinary editable bots, teams, rooms, skills and paused routines
 * with the server's defaults for host choices. Installing the same starter twice is allowed.
 */
export function mountStarterTeamRoutes(app: Hono<AppEnv>, deps: StarterTeamRouteDeps): void {
  app.get('/api/team-packages/starters', (c) => c.json(STARTER_TEAMS.map(starterTeamSummary)));

  app.post('/api/team-packages/starters/:id/install', async (c) => {
    const starter = starterTeamById(c.req.param('id'));
    if (starter === undefined) return c.json({ error: 'Starter team not found' }, 404);

    const pkg = starterTeamPackage(starter, deps.now?.() ?? new Date());
    const parsed = TeamPackage.safeParse(pkg);
    if (!parsed.success) {
      return c.json({ error: 'Invalid starter team', issues: parsed.error.issues }, 400);
    }
    const routineIssues = packageRoutineIssues(parsed.data);
    if (routineIssues.length > 0) {
      return c.json({ error: 'Invalid starter team', issues: routineIssues }, 400);
    }

    try {
      const counts = await importTeamPackage(deps.repos, parsed.data);
      try {
        await deps.record?.(c, {
          action: 'created',
          targetType: 'team-package',
          targetId: starter.id,
          summary: `Installed starter team "${starter.name}"`,
        });
      } catch (error) {
        // Activity is an audit convenience: never fail an install because its log line did not land.
        console.error('could not record starter team install', error);
      }
      return c.json(counts, 201);
    } catch (error) {
      console.error('starter team install failed', error);
      return c.json({ error: 'The starter team could not be installed; the partial import was rolled back.' }, 500);
    }
  });
}
