import { asc, eq, inArray, sql } from 'drizzle-orm';
import { Message, MessageRole, type Attachment } from '@brot/protocol';
import type { Db } from '../client';
import { attachments, messages } from '../schema';
import { toAttachment } from './attachments';
import { newId, nowIso, required } from './common';

type MessageRow = typeof messages.$inferSelect;

export interface CreateMessageInput {
  threadId: string;
  role: Message['role'];
  content: string;
  /** Optional pre-assigned id, so the harness can reference the message before it is stored. */
  id?: string;
  authorBotId?: string;
  mentions?: string[];
  viaBotId?: string;
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    authorBotId: row.authorBotId ?? undefined,
    mentions: row.mentions ?? undefined,
    viaBotId: row.viaBotId ?? undefined,
  };
}

export function createMessageRepo(db: Db) {
  /** Attachments each message carries, grouped by message id, in upload order. */
  async function attachmentsFor(ids: readonly string[]): Promise<Map<string, Attachment[]>> {
    const grouped = new Map<string, Attachment[]>();
    if (ids.length === 0) return grouped;
    const rows = await db
      .select()
      .from(attachments)
      .where(inArray(attachments.messageId, [...ids]))
      .orderBy(asc(attachments.createdAt), asc(sql`rowid`));
    for (const row of rows) {
      const messageId = row.messageId;
      if (messageId === null) continue;
      const list = grouped.get(messageId) ?? [];
      list.push(toAttachment(row));
      grouped.set(messageId, list);
    }
    return grouped;
  }

  function withAttachments(message: Message, grouped: Map<string, Attachment[]>): Message {
    const list = grouped.get(message.id);
    return list === undefined ? message : { ...message, attachments: list };
  }

  return {
    async listByThread(threadId: string): Promise<Message[]> {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.threadId, threadId))
        .orderBy(asc(messages.createdAt), asc(sql`rowid`));
      const grouped = await attachmentsFor(rows.map((row) => row.id));
      return rows.map((row) => withAttachments(toMessage(row), grouped));
    },

    async get(id: string): Promise<Message | undefined> {
      const [row] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
      if (!row) return undefined;
      return withAttachments(toMessage(row), await attachmentsFor([row.id]));
    },

    async create(input: CreateMessageInput): Promise<Message> {
      const role = MessageRole.parse(input.role);
      const team = Message.pick({ authorBotId: true, mentions: true, viaBotId: true }).parse(input);
      const [row] = await db
        .insert(messages)
        .values({
          id: input.id ?? newId(),
          threadId: input.threadId,
          role,
          content: input.content,
          createdAt: nowIso(),
          authorBotId: team.authorBotId ?? null,
          mentions: team.mentions ?? null,
          viaBotId: team.viaBotId ?? null,
        })
        .returning();
      return toMessage(required(row, 'message'));
    },
  };
}
