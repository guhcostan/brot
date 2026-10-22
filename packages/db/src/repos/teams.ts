import { asc, eq } from 'drizzle-orm';
import { CreateTeam, UpdateTeam, type CreateTeamInput, type Team } from '@brot/protocol';
import type { Db } from '../client';
import { bots, teams } from '../schema';
import { newId, nowIso, required } from './common';

type TeamRow = typeof teams.$inferSelect;

export function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    chiefBotId: row.chiefBotId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createTeamRepo(db: Db) {
  return {
    /** Every team, by name. */
    async list(): Promise<Team[]> {
      const rows = await db.select().from(teams).orderBy(asc(teams.name), asc(teams.id));
      return rows.map(toTeam);
    },

    async get(id: string): Promise<Team | undefined> {
      const [row] = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
      return row ? toTeam(row) : undefined;
    },

    async create(input: CreateTeamInput): Promise<Team> {
      const data = CreateTeam.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(teams)
        .values({ ...data, id: newId(), createdAt: timestamp, updatedAt: timestamp })
        .returning();
      return toTeam(required(row, 'team'));
    },

    async update(id: string, input: UpdateTeam): Promise<Team | undefined> {
      const patch = UpdateTeam.parse(input);
      const rows = await db
        .update(teams)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(teams.id, id))
        .returning();
      return rows[0] ? toTeam(rows[0]) : undefined;
    },

    /** Deletes the team and ungroups its bots. A team never deletes a bot. */
    async remove(id: string): Promise<boolean> {
      const timestamp = nowIso();
      await db.update(bots).set({ teamId: null, updatedAt: timestamp }).where(eq(bots.teamId, id));
      const rows = await db.delete(teams).where(eq(teams.id, id)).returning({ id: teams.id });
      return rows.length > 0;
    },
  };
}
