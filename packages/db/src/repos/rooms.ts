import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  CreateRoom,
  MAX_ROOM_BOTS,
  MIN_ROOM_BOTS,
  UpdateRoomMembers,
  type CreateRoomInput,
  type RoomMember,
  type Thread,
} from '@brot/protocol';
import type { Db } from '../client';
import { roomMembers, threads } from '../schema';
import { newId, nowIso, required } from './common';
import { toThread } from './threads';

type MemberRow = typeof roomMembers.$inferSelect;

export function toRoomMember(row: MemberRow): RoomMember {
  return { threadId: row.threadId, botId: row.botId, joinedAt: row.joinedAt };
}

export function createRoomRepo(db: Db) {
  async function listMembers(threadId: string): Promise<RoomMember[]> {
    const rows = await db
      .select()
      .from(roomMembers)
      .where(eq(roomMembers.threadId, threadId))
      .orderBy(asc(roomMembers.joinedAt), asc(roomMembers.botId));
    return rows.map(toRoomMember);
  }

  return {
    /**
     * Creates a room and its members in one transaction. The room's `botId` is the lead bot, so the
     * existing one-bot-per-thread code keeps pointing at the lead.
     */
    async create(input: CreateRoomInput): Promise<Thread> {
      const data = CreateRoom.parse(input);
      const id = newId();
      const timestamp = nowIso();
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(threads)
          .values({
            id,
            botId: data.leadBotId,
            title: data.title,
            kind: 'room',
            leadBotId: data.leadBotId,
            responder: data.responder,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
        await tx
          .insert(roomMembers)
          .values(data.botIds.map((botId) => ({ threadId: id, botId, joinedAt: timestamp })));
        return toThread(required(row, 'room'));
      });
    },

    /** Members of a room, earliest joined first. Empty for a DM or an unknown thread. */
    listMembers,

    /**
     * Adds and removes members, then returns the room's members. Returns undefined for an unknown thread.
     * Throws, and changes nothing, when the thread is not a room, when the lead bot would leave, or when
     * the room would end up outside `MIN_ROOM_BOTS..MAX_ROOM_BOTS` bots. Adding a member who is already
     * in the room, or removing one who is not, is a no-op.
     */
    async updateMembers(threadId: string, input: UpdateRoomMembers): Promise<RoomMember[] | undefined> {
      const data = UpdateRoomMembers.parse(input);
      const found = await db.transaction(async (tx) => {
        const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId)).limit(1);
        if (!thread) return false;
        if (thread.kind !== 'room' || thread.leadBotId === null) {
          throw new Error(`thread ${threadId} is not a room`);
        }

        const remove = data.remove ?? [];
        if (remove.includes(thread.leadBotId)) {
          throw new Error('the lead bot cannot leave its room');
        }

        const currentRows = await tx
          .select({ botId: roomMembers.botId })
          .from(roomMembers)
          .where(eq(roomMembers.threadId, threadId));
        const current = new Set(currentRows.map((row) => row.botId));
        const add = [...new Set(data.add ?? [])];
        const next = new Set(current);
        for (const botId of add) next.add(botId);
        for (const botId of remove) next.delete(botId);
        if (next.size < MIN_ROOM_BOTS || next.size > MAX_ROOM_BOTS) {
          throw new Error(`a room holds ${MIN_ROOM_BOTS} to ${MAX_ROOM_BOTS} bots, not ${next.size}`);
        }

        const timestamp = nowIso();
        if (remove.length > 0) {
          await tx
            .delete(roomMembers)
            .where(and(eq(roomMembers.threadId, threadId), inArray(roomMembers.botId, remove)));
        }
        const joining = add.filter((botId) => !current.has(botId));
        if (joining.length > 0) {
          await tx.insert(roomMembers).values(joining.map((botId) => ({ threadId, botId, joinedAt: timestamp })));
        }
        if (joining.length > 0 || remove.some((botId) => current.has(botId))) {
          await tx.update(threads).set({ updatedAt: timestamp }).where(eq(threads.id, threadId));
        }
        return true;
      });
      return found ? listMembers(threadId) : undefined;
    },
  };
}
