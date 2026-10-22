import { asc, eq } from 'drizzle-orm';
import { CreateMcpServer, McpServer, UpdateMcpServer, type CreateMcpServerInput } from '@brot/protocol';
import type { Db } from '../client';
import { mcpServers } from '../schema';
import { newId, nowIso, required } from './common';

type McpServerRow = typeof mcpServers.$inferSelect;

export function toMcpServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command ?? undefined,
    args: row.args,
    env: row.env,
    url: row.url ?? undefined,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createMcpServerRepo(db: Db) {
  async function get(id: string): Promise<McpServer | undefined> {
    const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1);
    return row ? toMcpServer(row) : undefined;
  }

  return {
    async list(): Promise<McpServer[]> {
      const rows = await db.select().from(mcpServers).orderBy(asc(mcpServers.name), asc(mcpServers.id));
      return rows.map(toMcpServer);
    },

    /** The servers a run attaches: disabled ones stay stored but out of every run. */
    async listEnabled(): Promise<McpServer[]> {
      const rows = await db
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.enabled, true))
        .orderBy(asc(mcpServers.name), asc(mcpServers.id));
      return rows.map(toMcpServer);
    },

    get,

    async create(input: CreateMcpServerInput): Promise<McpServer> {
      const data = CreateMcpServer.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(mcpServers)
        .values({
          id: newId(),
          ...data,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toMcpServer(required(row, 'mcp server'));
    },

    /** Merges the patch into the stored server and validates the result, so the transport always has its field. */
    async update(id: string, input: UpdateMcpServer): Promise<McpServer | undefined> {
      const [row] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1);
      if (!row) return undefined;
      const patch = Object.fromEntries(
        Object.entries(UpdateMcpServer.parse(input)).filter(([, value]) => value !== undefined),
      );
      const merged = McpServer.parse({ ...toMcpServer(row), ...patch, updatedAt: nowIso() });
      const [updated] = await db
        .update(mcpServers)
        .set({
          name: merged.name,
          transport: merged.transport,
          command: merged.command ?? null,
          args: merged.args,
          env: merged.env,
          url: merged.url ?? null,
          enabled: merged.enabled,
          updatedAt: merged.updatedAt,
        })
        .where(eq(mcpServers.id, id))
        .returning();
      return updated ? toMcpServer(updated) : undefined;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(mcpServers).where(eq(mcpServers.id, id)).returning({ id: mcpServers.id });
      return rows.length > 0;
    },
  };
}
