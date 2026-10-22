import type { Repos } from '@brot/db';
import {
  MIN_ROOM_BOTS,
  TEAM_PACKAGE_FORMAT,
  TEAM_PACKAGE_VERSION,
  TeamPackage,
  formatTeamPackage,
  type Bot,
  type Routine,
  type Skill,
  type Team,
  type TeamPackageBot,
  type TeamPackageRoom,
  type TeamPackageRoutine,
  type TeamPackageSkill,
  type TeamPackageTeam,
  type Thread,
} from '@brot/protocol';

/** A rendered package: the parsed value (for callers and tests), its Markdown, and its download name. */
export interface TeamPackageExport {
  package: TeamPackage;
  markdown: string;
  filename: string;
}

/** Thrown when the selected scope holds no bots, so it cannot form a package (a package needs at least one). */
export class TeamPackageExportError extends Error {}

/** Turns a team name into a safe download name: lowercase ASCII words joined by dashes. */
export function teamSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'team' : slug;
}

function keyOf(keys: ReadonlyMap<string, string>, id: string, what: string): string {
  const key = keys.get(id);
  if (key === undefined) throw new Error(`the package has no key for ${what} ${id}`);
  return key;
}

function toTeamEntry(team: Team, teamKeys: ReadonlyMap<string, string>, botKeys: ReadonlyMap<string, string>): TeamPackageTeam {
  const chief = team.chiefBotId === undefined ? undefined : botKeys.get(team.chiefBotId);
  return {
    key: keyOf(teamKeys, team.id, 'team'),
    name: team.name,
    instructions: team.instructions,
    ...(chief === undefined ? {} : { chief }),
  };
}

function toBotEntry(bot: Bot, key: string, teamKeys: ReadonlyMap<string, string>): TeamPackageBot {
  const team = bot.teamId === undefined ? undefined : teamKeys.get(bot.teamId);
  return {
    key,
    name: bot.name,
    job: bot.job,
    instructions: bot.instructions,
    ...(bot.avatar === undefined ? {} : { avatar: bot.avatar }),
    ...(team === undefined ? {} : { team }),
  };
}

function toRoutineEntry(routine: Routine, botKeys: ReadonlyMap<string, string>): TeamPackageRoutine | undefined {
  if (routine.trigger.type !== 'cron') return undefined;
  const key = botKeys.get(routine.botId);
  if (key === undefined) return undefined;
  return {
    bot: key,
    name: routine.name,
    instruction: routine.instruction,
    cron: routine.trigger.cron,
    ...(routine.trigger.timezone === undefined ? {} : { timezone: routine.trigger.timezone }),
    ...(routine.catchUp === undefined ? {} : { catchUp: routine.catchUp }),
    ...(routine.rememberLastRun === undefined ? {} : { rememberLastRun: routine.rememberLastRun }),
    enabled: false,
  };
}

function toSkillEntry(skill: Skill, botKeys: ReadonlyMap<string, string>): TeamPackageSkill | undefined {
  if (skill.botId === undefined) return undefined;
  const key = botKeys.get(skill.botId);
  if (key === undefined) return undefined;
  return { name: skill.name, description: skill.description, body: skill.body, bot: key };
}

interface SelectedScope {
  teams: Team[];
  bots: Bot[];
  team?: Team;
}

async function selectScope(
  repos: Repos,
  teams: Team[],
  bots: Bot[],
  teamId: string | undefined,
): Promise<SelectedScope | undefined> {
  if (teamId === undefined) return { teams, bots };
  const team = teams.find((candidate) => candidate.id === teamId) ?? (await repos.teams.get(teamId));
  if (team === undefined) return undefined;
  return { teams: [team], bots: bots.filter((bot) => bot.teamId === team.id), team };
}

async function toRoomEntry(
  repos: Repos,
  room: Thread,
  botKeys: ReadonlyMap<string, string>,
): Promise<TeamPackageRoom | undefined> {
  const lead = botKeys.get(room.leadBotId ?? room.botId);
  if (lead === undefined) return undefined;
  const members = [
    ...new Set((await repos.rooms.listMembers(room.id)).map((member) => botKeys.get(member.botId))),
  ].filter((key): key is string => key !== undefined);
  if (members.length < MIN_ROOM_BOTS || !members.includes(lead)) return undefined;
  return {
    title: room.title,
    lead,
    members,
    ...(room.responder === undefined ? {} : { responder: room.responder }),
  };
}

/**
 * Builds a portable package from what is in the database.
 *
 * - With `teamId`: that team, its non-archived bots, rooms led by one of them, and those bots' cron routines
 *   and bot-scoped skills. A room whose non-team members would leave it under the room minimum is dropped,
 *   because the exported file must stand on its own.
 * - Without `teamId`: the whole workspace: every team and every non-archived bot, all rooms, all cron routines
 *   and all bot-scoped skills.
 *
 * Never exported: threads, messages, runs, memories, engine/model/computer/browser/egress/budget choices,
 * server ids, webhook routine secrets, and shared (non-bot-scoped) skills. Routines are written paused; an
 * import creates them disabled. Returns undefined for an unknown team id.
 */
export async function exportTeamPackage(
  repos: Repos,
  options: { teamId?: string; now?: () => Date } = {},
): Promise<TeamPackageExport | undefined> {
  const teams = await repos.teams.list();
  const bots = await repos.bots.list();
  const selected = await selectScope(repos, teams, bots, options.teamId);
  if (selected === undefined) return undefined;
  if (selected.bots.length === 0) {
    throw new TeamPackageExportError(
      selected.team === undefined ? 'There are no bots to export.' : `Team "${selected.team.name}" has no bots to export.`,
    );
  }

  const teamKeys = new Map<string, string>();
  selected.teams.forEach((team, index) => teamKeys.set(team.id, `t${index + 1}`));
  const botKeys = new Map<string, string>();
  selected.bots.forEach((bot, index) => botKeys.set(bot.id, `b${index + 1}`));

  const roomEntries: TeamPackageRoom[] = [];
  for (const room of await repos.threads.listRooms()) {
    const entry = await toRoomEntry(repos, room, botKeys);
    if (entry !== undefined) roomEntries.push(entry);
  }

  const routines = (await repos.routines.list())
    .map((routine) => toRoutineEntry(routine, botKeys))
    .filter((entry): entry is TeamPackageRoutine => entry !== undefined);
  const skills = (await repos.skills.list())
    .map((skill) => toSkillEntry(skill, botKeys))
    .filter((entry): entry is TeamPackageSkill => entry !== undefined);

  const pkg = TeamPackage.parse({
    format: TEAM_PACKAGE_FORMAT,
    version: TEAM_PACKAGE_VERSION,
    exportedAt: (options.now ?? (() => new Date()))().toISOString(),
    teams: selected.teams.map((team) => toTeamEntry(team, teamKeys, botKeys)),
    bots: selected.bots.map((bot) => toBotEntry(bot, keyOf(botKeys, bot.id, 'bot'), teamKeys)),
    rooms: roomEntries,
    routines,
    skills,
  });
  const filename = selected.team === undefined ? 'brot-workspace.md' : `brot-team-${teamSlug(selected.team.name)}.md`;
  return { package: pkg, markdown: formatTeamPackage(pkg), filename };
}
