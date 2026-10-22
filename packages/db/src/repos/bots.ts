import { asc, eq } from 'drizzle-orm';
import { CreateBot, UpdateBot, type Bot, type CreateBotInput } from '@brot/protocol';
import type { Db } from '../client';
import { bots } from '../schema';
import { newId, nowIso, required } from './common';

type BotRow = typeof bots.$inferSelect;

export function toBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    job: row.job,
    instructions: row.instructions,
    avatar: row.avatar ?? undefined,
    teamId: row.teamId ?? undefined,
    engine: row.engine,
    model: row.model ?? undefined,
    computer: row.computer,
    ...(row.desktop ? { desktop: true } : {}),
    ...(row.browser ? { browser: true } : {}),
    ...(row.notifications ? {} : { notifications: false }),
    egress: row.egress,
    teamBudgetUsd: row.teamBudgetUsd ?? undefined,
    pinned: row.pinned,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createBotRepo(db: Db) {
  return {
    async list(options: { includeArchived?: boolean } = {}): Promise<Bot[]> {
      const rows = await db
        .select()
        .from(bots)
        .where(options.includeArchived ? undefined : eq(bots.archived, false))
        .orderBy(asc(bots.createdAt));
      return rows.map(toBot);
    },

    async get(id: string): Promise<Bot | undefined> {
      const [row] = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
      return row ? toBot(row) : undefined;
    },

    async create(input: CreateBotInput): Promise<Bot> {
      const { hostAcknowledged: _acknowledged, ...data } = CreateBot.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(bots)
        .values({
          ...data,
          id: newId(),
          pinned: false,
          archived: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toBot(required(row, 'bot'));
    },

    async update(id: string, input: UpdateBot): Promise<Bot | undefined> {
      const { hostAcknowledged: _acknowledged, ...patch } = UpdateBot.parse(input);
      const rows = await db
        .update(bots)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(bots.id, id))
        .returning();
      return rows[0] ? toBot(rows[0]) : undefined;
    },

    /** Deletes the bot. Threads, messages, runs, approvals, memories, routines, and policies cascade. */
    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(bots)
        .where(eq(bots.id, id))
        .returning({ id: bots.id });
      return rows.length > 0;
    },
  };
}
