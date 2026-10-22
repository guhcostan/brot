import { parseTeamPackage, type TeamPackage, type TeamPackageIssue } from '@brot/protocol';

/** What a package carries, by name, so a person can check it before importing. */
export interface TeamPackagePreview {
  teams: string[];
  bots: string[];
  rooms: string[];
  routines: string[];
  skills: string[];
  counts: {
    teams: number;
    bots: number;
    rooms: number;
    routines: number;
    skills: number;
  };
}

export type TeamPackagePreviewResult =
  | { ok: true; preview: TeamPackagePreview }
  | { ok: false; issues: TeamPackageIssue[] };

/**
 * Reads a pasted or loaded package with the protocol's own parser (no server call), and lists what it
 * would create. The parse is total: a bad file yields the parser's issues instead of throwing.
 */
export function previewTeamPackage(content: string): TeamPackagePreviewResult {
  const parsed = parseTeamPackage(content);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  return { ok: true, preview: summarize(parsed.package) };
}

function summarize(pkg: TeamPackage): TeamPackagePreview {
  return {
    teams: pkg.teams.map((team) => team.name),
    bots: pkg.bots.map((bot) => bot.name),
    rooms: pkg.rooms.map((room) => room.title),
    routines: pkg.routines.map((routine) => routine.name),
    skills: pkg.skills.map((skill) => skill.name),
    counts: {
      teams: pkg.teams.length,
      bots: pkg.bots.length,
      rooms: pkg.rooms.length,
      routines: pkg.routines.length,
      skills: pkg.skills.length,
    },
  };
}

/** One parse issue as a short readable line, with its path when it has one. */
export function packageIssueText(issue: TeamPackageIssue): string {
  return issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`;
}
