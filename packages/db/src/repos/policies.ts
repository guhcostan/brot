import { asc, eq } from 'drizzle-orm';
import { CreatePolicy, type CreatePolicy as CreatePolicyInput, type Policy } from '@brot/protocol';
import type { Db } from '../client';
import { policies } from '../schema';
import { newId, nowIso, required } from './common';

type PolicyRow = typeof policies.$inferSelect;

export function toPolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    botId: row.botId,
    tool: row.tool,
    argPattern: row.argPattern ?? undefined,
    effect: row.effect,
    createdAt: row.createdAt,
  };
}

export function createPolicyRepo(db: Db) {
  return {
    async listByBot(botId: string): Promise<Policy[]> {
      const rows = await db
        .select()
        .from(policies)
        .where(eq(policies.botId, botId))
        .orderBy(asc(policies.createdAt), asc(policies.id));
      return rows.map(toPolicy);
    },

    async create(botId: string, input: CreatePolicyInput): Promise<Policy> {
      const data = CreatePolicy.parse(input);
      const [row] = await db
        .insert(policies)
        .values({
          id: newId(),
          botId,
          tool: data.tool,
          argPattern: data.argPattern ?? null,
          effect: data.effect,
          createdAt: nowIso(),
        })
        .returning();
      return toPolicy(required(row, 'policy'));
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(policies).where(eq(policies.id, id)).returning({ id: policies.id });
      return rows.length > 0;
    },
  };
}
