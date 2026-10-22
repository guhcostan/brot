import { asc, eq, inArray, sql } from 'drizzle-orm';
import { CreateAttachment, attachmentKindFor, type Attachment } from '@brot/protocol';
import type { Db } from '../client';
import { attachments } from '../schema';
import { newId, nowIso, required } from './common';

type AttachmentRow = typeof attachments.$inferSelect;

/** What the server writes after it has the bytes: the upload metadata plus the content digest. */
export interface CreateAttachmentRecord extends CreateAttachment {
  /** Hex SHA-256 of the stored bytes. */
  sha256: string;
  /** Pre-assigned id, so the file and the row can share it before either is written. */
  id?: string;
}

/** An attachment as stored, with the thread that owns it (the API entity leaves that implicit). */
export interface StoredAttachment extends Attachment {
  threadId: string;
}

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    kind: attachmentKindFor(row.mimeType),
    createdAt: row.createdAt,
    ...(row.messageId === null ? {} : { messageId: row.messageId }),
  };
}

export function toStoredAttachment(row: AttachmentRow): StoredAttachment {
  return { ...toAttachment(row), threadId: row.threadId };
}

export function createAttachmentRepo(db: Db) {
  return {
    /** Stores the metadata. The bytes are written by the server's attachment storage. */
    async create(input: CreateAttachmentRecord): Promise<Attachment> {
      const metadata = CreateAttachment.parse(input);
      const [row] = await db
        .insert(attachments)
        .values({
          id: input.id ?? newId(),
          threadId: metadata.threadId,
          messageId: null,
          name: metadata.name,
          mimeType: metadata.mimeType,
          size: metadata.size,
          sha256: input.sha256,
          createdAt: nowIso(),
        })
        .returning();
      return toAttachment(required(row, 'attachment'));
    },

    /** Every stored attachment id: the files a boot sweep must keep. */
    async listIds(): Promise<string[]> {
      const rows = await db.select({ id: attachments.id }).from(attachments).orderBy(asc(attachments.id));
      return rows.map((row) => row.id);
    },

    async get(id: string): Promise<Attachment | undefined> {
      const [row] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
      return row ? toAttachment(row) : undefined;
    },

    async listByThread(threadId: string): Promise<Attachment[]> {
      const rows = await db
        .select()
        .from(attachments)
        .where(eq(attachments.threadId, threadId))
        .orderBy(asc(attachments.createdAt), asc(sql`rowid`));
      return rows.map(toAttachment);
    },

    /** The stored attachments among `ids`, in upload order, with their thread. Ids that name nothing are absent. */
    async listByIds(ids: readonly string[]): Promise<StoredAttachment[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(attachments)
        .where(inArray(attachments.id, [...ids]))
        .orderBy(asc(attachments.createdAt), asc(sql`rowid`));
      return rows.map(toStoredAttachment);
    },

    /** Links attachments to the message that carries them. Already-linked ids are left as they are. */
    async linkToMessage(ids: readonly string[], messageId: string): Promise<void> {
      if (ids.length === 0) return;
      await db.update(attachments).set({ messageId }).where(inArray(attachments.id, [...ids]));
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(attachments).where(eq(attachments.id, id)).returning({ id: attachments.id });
      return rows.length > 0;
    },
  };
}
