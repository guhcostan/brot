import { z } from 'zod';
import { MIN_ROOM_BOTS, MAX_ROOM_BOTS } from './constants';
import { IsoDateTime } from './entities';

/** The package format marker and the only version this build reads or writes. */
export const TEAM_PACKAGE_FORMAT = 'brot.team';
export const TEAM_PACKAGE_VERSION = 1;

/** The Markdown heading a package file starts with. Raw JSON is accepted too. */
export const TEAM_PACKAGE_HEADING = '# Brot team package';

/** The largest package the importer accepts, in UTF-8 bytes. */
export const TEAM_PACKAGE_MAX_BYTES = 1024 * 1024;

/** The request body cap for the import route, in characters (slightly above the package cap). */
export const TEAM_PACKAGE_IMPORT_MAX_CHARS = 1_500_000;

/** A local key, unique within its kind and meaningful only inside one package (`b1`, `t1`, ...). */
const PackageKey = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i, 'expected a local key such as b1');

/** A team in a package. `chief` names a bot key, so it survives a new install's ids. */
export const TeamPackageTeam = z.strictObject({
  key: PackageKey,
  name: z.string().min(1).max(500),
  instructions: z.string().max(50_000),
  chief: PackageKey.optional(),
});
export type TeamPackageTeam = z.infer<typeof TeamPackageTeam>;

/**
 * A bot in a package. Only its job, instructions and look travel: engine, model, computer, browser,
 * egress and budget are host choices, so an imported bot gets the server defaults for them.
 */
export const TeamPackageBot = z.strictObject({
  key: PackageKey,
  name: z.string().min(1).max(500),
  job: z.string().min(1).max(500),
  instructions: z.string().max(50_000),
  avatar: z.string().max(64).optional(),
  team: PackageKey.optional(),
});
export type TeamPackageBot = z.infer<typeof TeamPackageBot>;

/**
 * A room in a package. `members` includes the `lead`. `responder` uses the stored modes, `auto` included; when
 * absent the room defaults to `lead` on import.
 */
export const TeamPackageResponder = z.enum(['lead', 'mention', 'auto']);
export type TeamPackageResponder = z.infer<typeof TeamPackageResponder>;

export const TeamPackageRoom = z.strictObject({
  title: z.string().min(1).max(500),
  lead: PackageKey,
  members: z.array(PackageKey).min(MIN_ROOM_BOTS).max(MAX_ROOM_BOTS),
  responder: TeamPackageResponder.optional(),
});
export type TeamPackageRoom = z.infer<typeof TeamPackageRoom>;

/**
 * A cron routine in a package. Webhook routines are never exported (their secret is the credential), and
 * imported routines are always created paused (`enabled: false`), whatever the file says.
 */
export const TeamPackageRoutine = z.strictObject({
  bot: PackageKey,
  name: z.string().min(1).max(500),
  instruction: z.string().max(50_000),
  cron: z.string().min(1).max(200),
  timezone: z.string().min(1).max(64).optional(),
  catchUp: z.boolean().optional(),
  rememberLastRun: z.boolean().optional(),
  enabled: z.boolean(),
});
export type TeamPackageRoutine = z.infer<typeof TeamPackageRoutine>;

/** A skill in a package: bot-scoped when `bot` is given, shared (host-wide) otherwise. */
export const TeamPackageSkill = z.strictObject({
  name: z.string().min(1).max(500),
  description: z.string().max(5_000),
  body: z.string().max(500_000),
  bot: PackageKey.optional(),
});
export type TeamPackageSkill = z.infer<typeof TeamPackageSkill>;

/** One portable team/workspace file. Strict, so unknown fields fail instead of being silently dropped. */
export const TeamPackage = z
  .strictObject({
    format: z.literal(TEAM_PACKAGE_FORMAT),
    version: z.literal(TEAM_PACKAGE_VERSION),
    exportedAt: IsoDateTime,
    teams: z.array(TeamPackageTeam).max(200),
    bots: z.array(TeamPackageBot).min(1).max(500),
    rooms: z.array(TeamPackageRoom).max(200),
    routines: z.array(TeamPackageRoutine).max(500),
    skills: z.array(TeamPackageSkill).max(500),
  })
  .superRefine((pkg, ctx) => {
    const teams = new Set<string>();
    pkg.teams.forEach((team, index) => {
      if (teams.has(team.key)) ctx.addIssue({ code: 'custom', path: ['teams', index, 'key'], message: 'duplicate team key' });
      teams.add(team.key);
    });
    const bots = new Set<string>();
    pkg.bots.forEach((bot, index) => {
      if (bots.has(bot.key)) ctx.addIssue({ code: 'custom', path: ['bots', index, 'key'], message: 'duplicate bot key' });
      bots.add(bot.key);
    });

    pkg.bots.forEach((bot, index) => {
      if (bot.team !== undefined && !teams.has(bot.team)) {
        ctx.addIssue({ code: 'custom', path: ['bots', index, 'team'], message: `unknown team ${bot.team}` });
      }
    });
    pkg.teams.forEach((team, index) => {
      if (team.chief !== undefined && !bots.has(team.chief)) {
        ctx.addIssue({ code: 'custom', path: ['teams', index, 'chief'], message: `unknown bot ${team.chief}` });
      }
    });
    pkg.rooms.forEach((room, index) => {
      if (!bots.has(room.lead)) {
        ctx.addIssue({ code: 'custom', path: ['rooms', index, 'lead'], message: `unknown bot ${room.lead}` });
      }
      const members = new Set<string>();
      room.members.forEach((member, memberIndex) => {
        if (!bots.has(member)) {
          ctx.addIssue({ code: 'custom', path: ['rooms', index, 'members', memberIndex], message: `unknown bot ${member}` });
        }
        if (members.has(member)) {
          ctx.addIssue({ code: 'custom', path: ['rooms', index, 'members', memberIndex], message: 'duplicate room member' });
        }
        members.add(member);
      });
      if (!members.has(room.lead)) {
        ctx.addIssue({ code: 'custom', path: ['rooms', index, 'members'], message: 'the lead bot must be a member' });
      }
    });
    pkg.routines.forEach((routine, index) => {
      if (!bots.has(routine.bot)) {
        ctx.addIssue({ code: 'custom', path: ['routines', index, 'bot'], message: `unknown bot ${routine.bot}` });
      }
    });
    pkg.skills.forEach((skill, index) => {
      if (skill.bot !== undefined && !bots.has(skill.bot)) {
        ctx.addIssue({ code: 'custom', path: ['skills', index, 'bot'], message: `unknown bot ${skill.bot}` });
      }
    });
  });
export type TeamPackage = z.infer<typeof TeamPackage>;

/** The import request body: the file's text, Markdown-wrapped or raw JSON. */
export const ImportTeamPackage = z.object({
  content: z.string().min(1).max(TEAM_PACKAGE_IMPORT_MAX_CHARS),
});
export type ImportTeamPackage = z.infer<typeof ImportTeamPackage>;

export interface TeamPackageIssue {
  path: (string | number)[];
  message: string;
}

export type TeamPackageParseResult =
  | { ok: true; package: TeamPackage }
  | { ok: false; issues: TeamPackageIssue[] };

/** Writes a package as the Markdown wrapper: the heading, then one fenced `json` block. */
export function formatTeamPackage(pkg: TeamPackage): string {
  return `${TEAM_PACKAGE_HEADING}\n\n\`\`\`json\n${JSON.stringify(pkg, null, 2)}\n\`\`\`\n`;
}

function extractJson(content: string): string | undefined {
  if (content.startsWith('{')) return content;
  const match = /```json[ \t]*\r?\n([\s\S]*?)```/i.exec(content);
  return match?.[1]?.trim();
}

/**
 * Parses a package from Markdown or raw JSON. Nothing here touches the database, so a caller can validate the
 * whole package before writing anything.
 */
export function parseTeamPackage(content: string): TeamPackageParseResult {
  const trimmed = content.trim();
  if (trimmed === '') return { ok: false, issues: [{ path: [], message: 'the package is empty' }] };
  if (new TextEncoder().encode(content).byteLength > TEAM_PACKAGE_MAX_BYTES) {
    return {
      ok: false,
      issues: [{ path: [], message: `a package is at most ${TEAM_PACKAGE_MAX_BYTES} bytes` }],
    };
  }
  const json = extractJson(trimmed);
  if (json === undefined) {
    return {
      ok: false,
      issues: [{ path: [], message: 'expected raw JSON, or Markdown with a ```json block' }],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, issues: [{ path: [], message: `invalid JSON: ${message}` }] };
  }
  const parsed = TeamPackage.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
        message: issue.message,
      })),
    };
  }
  return { ok: true, package: parsed.data };
}
