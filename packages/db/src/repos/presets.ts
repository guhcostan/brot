import { asc, eq } from 'drizzle-orm';
import {
  CreateBotPreset,
  UpdateBotPreset,
  type BotPreset,
  type CreateBotPresetInput,
} from '@brot/protocol';
import type { Db } from '../client';
import { botPresets } from '../schema';
import { newId, nowIso, required } from './common';

type BotPresetRow = typeof botPresets.$inferSelect;

export function toBotPreset(row: BotPresetRow): BotPreset {
  return {
    id: row.id,
    name: row.name,
    job: row.job,
    instructions: row.instructions,
    avatar: row.avatar ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createBotPresetRepo(db: Db) {
  return {
    /** Every preset, by name. Two presets may share a name; the id breaks ties. */
    async list(): Promise<BotPreset[]> {
      const rows = await db.select().from(botPresets).orderBy(asc(botPresets.name), asc(botPresets.id));
      return rows.map(toBotPreset);
    },

    async get(id: string): Promise<BotPreset | undefined> {
      const [row] = await db.select().from(botPresets).where(eq(botPresets.id, id)).limit(1);
      return row ? toBotPreset(row) : undefined;
    },

    async create(input: CreateBotPresetInput): Promise<BotPreset> {
      const data = CreateBotPreset.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(botPresets)
        .values({
          id: newId(),
          name: data.name,
          job: data.job,
          instructions: data.instructions,
          avatar: data.avatar ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toBotPreset(required(row, 'bot preset'));
    },

    async update(id: string, input: UpdateBotPreset): Promise<BotPreset | undefined> {
      const patch = UpdateBotPreset.parse(input);
      const rows = await db
        .update(botPresets)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(botPresets.id, id))
        .returning();
      return rows[0] ? toBotPreset(rows[0]) : undefined;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(botPresets).where(eq(botPresets.id, id)).returning({ id: botPresets.id });
      return rows.length > 0;
    },
  };
}
