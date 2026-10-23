import type { Repos } from '@brot/db';
import type { TeamPackage, TeamPackageIssue } from '@brot/protocol';
import { triggerIssues } from '../scheduler';

/** How many entities an import created. */
export interface TeamPackageImportCounts {
  teams: number;
  bots: number;
  rooms: number;
  routines: number;
  skills: number;
}

/** The avatar form bots store: `species:color`. Legacy shape names fit it too. */
const AVATAR_VALUE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/** Whether an exported avatar can be imported. Unknown forms are omitted rather than failing the import. */
export function isImportableAvatar(value: string): boolean {
  return value.length <= 64 && AVATAR_VALUE.test(value);
}

/** Cron and timezone issues in a package's routines, so a bad schedule is refused before anything is written. */
export function packageRoutineIssues(pkg: TeamPackage): TeamPackageIssue[] {
  const issues: TeamPackageIssue[] = [];
  pkg.routines.forEach((routine, index) => {
    const trigger = { type: 'cron' as const, cron: routine.cron, ...(routine.timezone === undefined ? {} : { timezone: routine.timezone }) };
    for (const issue of triggerIssues(trigger)) {
      issues.push({ path: ['routines', index, issue.path.at(-1) ?? 'cron'], message: issue.message });
    }
  });
  return issues;
}

interface CreatedIds {
  teams: string[];
  bots: string[];
  routines: string[];
  skills: string[];
}

function mapped(ids: ReadonlyMap<string, string>, key: string, what: string): string {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`the package names an unknown ${what} "${key}"`);
  return id;
}

/** Best effort: remove everything the failed import created, newest kind first. Bots cascade their rooms. */
async function rollback(repos: Repos, created: CreatedIds): Promise<void> {
  const steps: Array<() => Promise<unknown>> = [
    ...created.skills.splice(0).reverse().map((id) => () => repos.skills.remove(id)),
    ...created.routines.splice(0).reverse().map((id) => () => repos.routines.remove(id)),
    ...created.bots.splice(0).reverse().map((id) => () => repos.bots.remove(id)),
    ...created.teams.splice(0).reverse().map((id) => () => repos.teams.remove(id)),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      console.error('team package rollback step failed', error);
    }
  }
}

/**
 * Creates fresh entities from a validated package and returns the counts. Every relationship is re-resolved
 * through package keys; a reference that somehow no longer resolves aborts the import. A write failure rolls
 * back what this import created (best effort) and rethrows, so the caller can answer 500.
 *
 * Imported bots get the server defaults for host choices: engine `mock`, the default sandbox computer, no
 * model, browser, desktop, egress allow-list or budget. Routines are created disabled. A skill without a bot
 * key is created as a shared skill. An avatar that does not fit the `species:color` form is omitted.
 */
export async function importTeamPackage(repos: Repos, pkg: TeamPackage): Promise<TeamPackageImportCounts> {
  const created: CreatedIds = { teams: [], bots: [], routines: [], skills: [] };
  const teamIds = new Map<string, string>();
  const botIds = new Map<string, string>();
  try {
    for (const entry of pkg.teams) {
      const team = await repos.teams.create({ name: entry.name, instructions: entry.instructions });
      teamIds.set(entry.key, team.id);
      created.teams.push(team.id);
    }

    for (const entry of pkg.bots) {
      const avatar = entry.avatar !== undefined && isImportableAvatar(entry.avatar) ? entry.avatar : undefined;
      const bot = await repos.bots.create({
        name: entry.name,
        job: entry.job,
        instructions: entry.instructions,
        ...(avatar === undefined ? {} : { avatar }),
        ...(entry.team === undefined ? {} : { teamId: mapped(teamIds, entry.team, 'team') }),
      });
      botIds.set(entry.key, bot.id);
      created.bots.push(bot.id);
    }

    // The chief needs its bot id, so it is set once every bot exists.
    for (const entry of pkg.teams) {
      if (entry.chief === undefined) continue;
      await repos.teams.update(mapped(teamIds, entry.key, 'team'), {
        chiefBotId: mapped(botIds, entry.chief, 'bot'),
      });
    }

    for (const entry of pkg.rooms) {
      // Older packages may omit the responder; the room default (`lead`) applies then. `auto` is preserved.
      const responder = entry.responder;
      await repos.rooms.create({
        title: entry.title,
        leadBotId: mapped(botIds, entry.lead, 'bot'),
        botIds: entry.members.map((member) => mapped(botIds, member, 'bot')),
        ...(responder === undefined ? {} : { responder }),
      });
    }

    for (const entry of pkg.routines) {
      const routine = await repos.routines.create({
        botId: mapped(botIds, entry.bot, 'bot'),
        name: entry.name,
        instruction: entry.instruction,
        trigger: {
          type: 'cron',
          cron: entry.cron,
          ...(entry.timezone === undefined ? {} : { timezone: entry.timezone }),
        },
        enabled: false,
        ...(entry.catchUp === undefined ? {} : { catchUp: entry.catchUp }),
        ...(entry.rememberLastRun === undefined ? {} : { rememberLastRun: entry.rememberLastRun }),
      });
      created.routines.push(routine.id);
    }

    for (const entry of pkg.skills) {
      const skill = await repos.skills.create({
        name: entry.name,
        description: entry.description,
        body: entry.body,
        ...(entry.bot === undefined ? {} : { botId: mapped(botIds, entry.bot, 'bot') }),
      });
      created.skills.push(skill.id);
    }

    return {
      teams: pkg.teams.length,
      bots: pkg.bots.length,
      rooms: pkg.rooms.length,
      routines: pkg.routines.length,
      skills: pkg.skills.length,
    };
  } catch (error) {
    await rollback(repos, created);
    throw error;
  }
}
