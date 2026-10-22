import { asc, eq, inArray } from 'drizzle-orm';
import { CreateBot, UpdateBot, type Bot, type CreateBotInput } from '@brot/protocol';
import type { Db } from '../client';
import { bots, mcpServers } from '../schema';
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
    ...(row.browserProfileId === null ? {} : { browserProfileId: row.browserProfileId }),
    ...(row.notifications ? {} : { notifications: false }),
    ...(row.speakReplies ? { speakReplies: true } : {}),
    ...(row.approvalMode === 'ask' ? {} : { approvalMode: row.approvalMode }),
    ...(row.mcpServerIds === null ? {} : { mcpServerIds: row.mcpServerIds }),
    egress: row.egress,
    teamBudgetUsd: row.teamBudgetUsd ?? undefined,
    pinned: row.pinned,
    archived: row.archived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createBotRepo(db: Db) {
  /** The user MCP servers that still exist among `ids`: a grant keeps only these. */
  async function knownMcpServerIds(ids: readonly string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Set();
    const rows = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(inArray(mcpServers.id, unique));
    return new Set(rows.map((row) => row.id));
  }

  /** Drops stale ids from a bot's grant. A deleted server must not stay in the allowlist. */
  function pruneGrant(bot: Bot, known: ReadonlySet<string>): Bot {
    if (bot.mcpServerIds === undefined || bot.mcpServerIds === null) return bot;
    return { ...bot, mcpServerIds: bot.mcpServerIds.filter((id) => known.has(id)) };
  }

  async function mapBot(row: BotRow): Promise<Bot> {
    const bot = toBot(row);
    if (bot.mcpServerIds === undefined || bot.mcpServerIds === null) return bot;
    return pruneGrant(bot, await knownMcpServerIds(bot.mcpServerIds));
  }

  return {
    async list(options: { includeArchived?: boolean } = {}): Promise<Bot[]> {
      const rows = await db
        .select()
        .from(bots)
        .where(options.includeArchived ? undefined : eq(bots.archived, false))
        .orderBy(asc(bots.createdAt));
      const mapped = rows.map(toBot);
      const known = await knownMcpServerIds(mapped.flatMap((bot) => bot.mcpServerIds ?? []));
      return mapped.map((bot) => pruneGrant(bot, known));
    },

    async get(id: string): Promise<Bot | undefined> {
      const [row] = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
      return row ? mapBot(row) : undefined;
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
      return mapBot(required(row, 'bot'));
    },

    async update(id: string, input: UpdateBot): Promise<Bot | undefined> {
      const { hostAcknowledged: _acknowledged, ...patch } = UpdateBot.parse(input);
      const rows = await db
        .update(bots)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(bots.id, id))
        .returning();
      return rows[0] ? mapBot(rows[0]) : undefined;
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
