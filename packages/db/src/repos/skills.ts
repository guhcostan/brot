import { asc, eq, isNull, or, sql } from 'drizzle-orm';
import { CreateSkill, UpdateSkill, type Skill } from '@brot/protocol';
import type { Db } from '../client';
import { skills } from '../schema';
import { newId, nowIso, required } from './common';

type SkillRow = typeof skills.$inferSelect;

export function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    botId: row.botId ?? undefined,
    name: row.name,
    description: row.description,
    body: row.body,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSkillRepo(db: Db) {
  return {
    /** Without `botId`, returns every skill. With it, returns only skills owned by that bot. */
    async list(options: { botId?: string } = {}): Promise<Skill[]> {
      const rows = await db
        .select()
        .from(skills)
        .where(options.botId ? eq(skills.botId, options.botId) : undefined)
        .orderBy(asc(skills.name), asc(skills.id));
      return rows.map(toSkill);
    },

    /** Skills a bot can use: its own skills plus global skills (no `botId`). */
    async listForBot(botId: string): Promise<Skill[]> {
      const rows = await db
        .select()
        .from(skills)
        .where(or(eq(skills.botId, botId), isNull(skills.botId)))
        .orderBy(asc(skills.name), asc(skills.id));
      return rows.map(toSkill);
    },

    async get(id: string): Promise<Skill | undefined> {
      const [row] = await db.select().from(skills).where(eq(skills.id, id)).limit(1);
      return row ? toSkill(row) : undefined;
    },

    async create(input: CreateSkill): Promise<Skill> {
      const data = CreateSkill.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(skills)
        .values({
          id: newId(),
          botId: data.botId ?? null,
          name: data.name,
          description: data.description,
          body: data.body,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toSkill(required(row, 'skill'));
    },

    /** Applies a partial update and bumps `version` by one. */
    async update(id: string, input: UpdateSkill): Promise<Skill | undefined> {
      const patch = UpdateSkill.parse(input);
      const rows = await db
        .update(skills)
        .set({ ...patch, version: sql`${skills.version} + 1`, updatedAt: nowIso() })
        .where(eq(skills.id, id))
        .returning();
      return rows[0] ? toSkill(rows[0]) : undefined;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(skills).where(eq(skills.id, id)).returning({ id: skills.id });
      return rows.length > 0;
    },
  };
}
