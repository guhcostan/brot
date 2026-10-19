import { asc, eq, sql } from 'drizzle-orm';
import { MessageRole, type Message } from '@brot/protocol';
import type { Db } from '../client';
import { messages } from '../schema';
import { newId, nowIso, required } from './common';

type MessageRow = typeof messages.$inferSelect;

export interface CreateMessageInput {
  threadId: string;
  role: Message['role'];
  content: string;
  /** Optional pre-assigned id, so the harness can reference the message before it is stored. */
  id?: string;
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
  };
}

export function createMessageRepo(db: Db) {
  return {
    async listByThread(threadId: string): Promise<Message[]> {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.threadId, threadId))
        .orderBy(asc(messages.createdAt), asc(sql`rowid`));
      return rows.map(toMessage);
    },

    async create(input: CreateMessageInput): Promise<Message> {
      const role = MessageRole.parse(input.role);
      const [row] = await db
        .insert(messages)
        .values({
          id: input.id ?? newId(),
          threadId: input.threadId,
          role,
          content: input.content,
          createdAt: nowIso(),
        })
        .returning();
      return toMessage(required(row, 'message'));
    },
  };
}
