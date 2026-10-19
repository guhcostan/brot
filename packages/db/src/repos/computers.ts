import { eq } from 'drizzle-orm';
import { ComputerStateUpdate, type Computer } from '@brot/protocol';
import type { Db } from '../client';
import { computers } from '../schema';
import { newId, nowIso, required } from './common';

type ComputerRow = typeof computers.$inferSelect;

export function toComputer(row: ComputerRow): Computer {
  return {
    id: row.id,
    botId: row.botId,
    state: row.state,
    image: row.image,
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createComputerRepo(db: Db) {
  return {
    async getByBot(botId: string): Promise<Computer | undefined> {
      const [row] = await db.select().from(computers).where(eq(computers.botId, botId)).limit(1);
      return row ? toComputer(row) : undefined;
    },

    /**
     * Creates the bot's computer record on first use, then updates its state. `image` and `error` are
     * replaced on every call, so `error` is cleared when omitted.
     */
    async upsert(botId: string, input: ComputerStateUpdate): Promise<Computer> {
      const data = ComputerStateUpdate.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(computers)
        .values({
          id: newId(),
          botId,
          state: data.state,
          image: data.image,
          error: data.error ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: computers.botId,
          set: {
            state: data.state,
            image: data.image,
            error: data.error ?? null,
            updatedAt: timestamp,
          },
        })
        .returning();
      return toComputer(required(row, 'computer'));
    },
  };
}
