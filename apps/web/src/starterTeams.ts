/** A ready-made team the person can install from Settings; counts are what installing creates. */
export interface StarterTeamSummary {
  id: string;
  name: string;
  description: string;
  teamCount: number;
  botCount: number;
  roomCount: number;
  routineCount: number;
  skillCount: number;
}

/** What one starter install created, from `POST /api/team-packages/starters/:id/install`. */
export interface StarterTeamInstallCounts {
  bots: number;
  teams: number;
  rooms: number;
  routines: number;
  skills: number;
}

const countFields = ['teamCount', 'botCount', 'roomCount', 'routineCount', 'skillCount'] as const;
const installFields = ['bots', 'teams', 'rooms', 'routines', 'skills'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function parseStarterTeam(value: unknown): StarterTeamSummary {
  if (!isRecord(value)) throw new Error('Expected a starter team');
  for (const field of ['id', 'name', 'description'] as const) {
    if (typeof value[field] !== 'string' || value[field] === '') throw new Error(`Expected starter.${field}`);
  }
  const counts = Object.fromEntries(
    countFields.map((field) => {
      const count = value[field];
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error(`Expected starter.${field}`);
      return [field, count];
    }),
  ) as Record<(typeof countFields)[number], number>;
  return {
    id: value.id as string,
    name: value.name as string,
    description: value.description as string,
    ...counts,
  };
}

export function parseStarterTeams(value: unknown): StarterTeamSummary[] {
  if (!Array.isArray(value)) throw new Error('Expected the starter team list');
  return value.map(parseStarterTeam);
}

export function parseStarterTeamInstallCounts(value: unknown): StarterTeamInstallCounts {
  if (!isRecord(value)) throw new Error('Expected starter install counts');
  const counts = Object.fromEntries(
    installFields.map((field) => {
      const count = value[field];
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error(`Expected install.${field}`);
      return [field, count];
    }),
  ) as Record<(typeof installFields)[number], number>;
  return counts;
}
