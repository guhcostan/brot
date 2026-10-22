import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { Message, MessageRole, type Attachment, type ThreadKind } from '@brot/protocol';
import type { Db } from '../client';
import { attachments, bots, messages, threads } from '../schema';
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

export interface MessageSearchFilter {
  /** Literal, case-insensitive substring of the message content. */
  query: string;
  /** Only threads of this bot (`threads.botId`: a DM's bot or a room's lead). */
  botId?: string;
  threadId?: string;
  /** Only messages created strictly before this ISO instant. */
  before?: string;
  /** Applied in SQL. */
  limit: number;
}

/** A search row: the conversation context and the full content; the caller builds the snippet. */
export interface MessageSearchRow {
  id: string;
  threadId: string;
  threadTitle: string;
  threadKind: ThreadKind;
  /** The thread's bot: a DM's bot, or a room's lead (`threads.botId`) and its `leadBotId`. */
  threadBotId: string;
  threadLeadBotId?: string;
  threadBotName?: string;
  authorBotId?: string;
  authorBotName?: string;
  role: Message['role'];
  content: string;
  createdAt: string;
}

/** `query` as a literal LIKE contains pattern: `%`, `_` and `\` match themselves under `ESCAPE '\'`. */
function likeContainsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
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

    /**
     * Case-insensitive substring search over message content. The query is escaped so `%`, `_` and `\` match
     * literally, filters narrow by thread bot, thread and a strict older-than boundary, results are newest first
     * (createdAt, then id) and the limit is applied in SQL. Threads and bots are joined so callers get the title
     * and bot names without further queries.
     */
    async search(filter: MessageSearchFilter): Promise<MessageSearchRow[]> {
      const threadBot = alias(bots, 'search_thread_bot');
      const authorBot = alias(bots, 'search_author_bot');
      const before = filter.before === undefined ? undefined : new Date(filter.before).toISOString();
      const rows = await db
        .select({
          id: messages.id,
          threadId: messages.threadId,
          threadTitle: threads.title,
          threadKind: threads.kind,
          threadBotId: threads.botId,
          threadLeadBotId: threads.leadBotId,
          threadBotName: threadBot.name,
          authorBotId: messages.authorBotId,
          authorBotName: authorBot.name,
          role: messages.role,
          content: messages.content,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .innerJoin(threads, eq(messages.threadId, threads.id))
        .leftJoin(threadBot, eq(threads.botId, threadBot.id))
        .leftJoin(authorBot, eq(messages.authorBotId, authorBot.id))
        .where(
          and(
            sql`lower(${messages.content}) LIKE lower(${likeContainsPattern(filter.query)}) ESCAPE '\\'`,
            filter.botId === undefined ? undefined : eq(threads.botId, filter.botId),
            filter.threadId === undefined ? undefined : eq(messages.threadId, filter.threadId),
            before === undefined ? undefined : lt(messages.createdAt, before),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(filter.limit);
      return rows.map((row) => ({
        id: row.id,
        threadId: row.threadId,
        threadTitle: row.threadTitle,
        threadKind: row.threadKind,
        threadBotId: row.threadBotId,
        ...(row.threadLeadBotId === null ? {} : { threadLeadBotId: row.threadLeadBotId }),
        ...(row.threadBotName === null ? {} : { threadBotName: row.threadBotName }),
        ...(row.authorBotId === null ? {} : { authorBotId: row.authorBotId }),
        ...(row.authorBotName === null ? {} : { authorBotName: row.authorBotName }),
        role: row.role,
        content: row.content,
        createdAt: row.createdAt,
      }));
    },
  };
}
