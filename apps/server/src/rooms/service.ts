import type { Repos } from '@brot/db';
import { randomUUID } from 'node:crypto';
import {
  MAX_ROOM_BOTS,
  MIN_ROOM_BOTS,
  type Bot,
  type CreateRoomInput,
  type Message,
  type RoomMember,
  type Thread,
  type UpdateRoomMembers,
} from '@brot/protocol';
import type { EventBus } from '../bus';
import type { Harness } from '../harness';
import type { ChainRef } from '../team/types';
import { RuleViolation } from './errors';
import { chooseResponders, resolveMentions } from './routing';

export interface RoomPost {
  content: string;
  /** Explicit mention ids, from the request body. Ids that are not members are ignored. */
  mentions?: string[];
  /** Uploaded attachments to link to the message before the bots answer it. */
  attachmentIds?: readonly string[];
}

export interface RoomService {
  create(input: CreateRoomInput): Promise<Thread>;
  list(): Promise<Thread[]>;
  /** The rooms a bot is a member of. */
  listForBot(botId: string): Promise<Thread[]>;
  /** Members of a room, or undefined when the thread is not a room. */
  members(roomId: string): Promise<RoomMember[] | undefined>;
  /** Adds and removes members, or undefined when the thread is not a room. Throws `RuleViolation` on a rule break. */
  updateMembers(roomId: string, input: UpdateRoomMembers): Promise<RoomMember[] | undefined>;
  /**
   * Stores a user message in a room, links its attachments, and runs the bots that answer it one after
   * another, so each sees the earlier replies. Resolves with the first run's id (null when nobody answers)
   * and the persisted message, attachments included.
   */
  post(thread: Thread, input: RoomPost): Promise<{ runId: string | null; message: Message }>;
  /**
   * Stores the baton: `toBotId` answers the room's next message that nobody mentions. The `handoff` event is
   * published by the handoff tool, not here. Throws `RuleViolation` unless `toBotId` is a room member.
   */
  setBaton(threadId: string, toBotId: string): Promise<void>;
}

/**
 * Room operations. The baton is kept in memory: it lasts until the next message in its room or the server
 * restarts, whichever comes first.
 */
export function createRoomService(deps: { repos: Repos; bus: EventBus; harness: () => Harness }): RoomService {
  const { repos, bus } = deps;
  const batons = new Map<string, string>();

  /** The bots in a room, archived ones included. */
  async function memberBots(threadId: string): Promise<Bot[]> {
    const members = await repos.rooms.listMembers(threadId);
    const bots = await Promise.all(members.map((member) => repos.bots.get(member.botId)));
    return bots.filter((bot): bot is Bot => bot !== undefined);
  }

  async function publishMembers(threadId: string): Promise<void> {
    const members = await repos.rooms.listMembers(threadId);
    await bus.publish({ type: 'room.members', threadId, botIds: members.map((member) => member.botId) });
  }

  /**
   * Every reply to one message shares a chain, so the room's budget covers the whole exchange. A reply that cannot start
   * stops the rest, and the room says why.
   */
  async function startReplies(threadId: string, trigger: Message, responders: string[]): Promise<string | null> {
    const [first, ...rest] = responders;
    if (first === undefined) return null;
    const harness = deps.harness();
    const chain: ChainRef = { chainId: randomUUID(), depth: 0, askHops: 0 };
    let current = await harness.startBotRun({ botId: first, threadId, input: trigger.content, inputMessage: trigger, chain });
    const firstRunId = current.runId;
    void (async () => {
      for (const botId of rest) {
        const outcome = await current.settled;
        if (outcome.status === 'cancelled') return;
        current = await harness.startBotRun({ botId, threadId, input: trigger.content, inputMessage: trigger, chain });
      }
    })().catch(async (error: unknown) => {
      console.error(`room ${threadId} replies stopped`, error);
      await postNotice(threadId, `The room stopped before its next reply: ${error instanceof Error ? error.message : String(error)}`);
    });
    return firstRunId;
  }

  /** Stores a system note in a room, so a stopped exchange is visible in the timeline. */
  async function postNotice(threadId: string, content: string): Promise<void> {
    try {
      const message = await repos.messages.create({ threadId, role: 'system', content });
      await bus.publish({ type: 'message.completed', threadId, message });
    } catch (error) {
      console.error(`room ${threadId} could not record a notice`, error);
    }
  }

  return {
    async create(input) {
      const thread = await repos.rooms.create(input);
      await bus.publish({ type: 'room.members', threadId: thread.id, botIds: input.botIds });
      return thread;
    },

    list() {
      return repos.threads.listRooms();
    },

    async listForBot(botId) {
      const rooms = await repos.threads.listRooms();
      const withMember = await Promise.all(
        rooms.map(async (room) => ({ room, members: await repos.rooms.listMembers(room.id) })),
      );
      return withMember.filter(({ members }) => members.some((member) => member.botId === botId)).map(({ room }) => room);
    },

    async members(roomId) {
      const thread = await repos.threads.get(roomId);
      if (!thread || thread.kind !== 'room') return undefined;
      return repos.rooms.listMembers(roomId);
    },

    async updateMembers(roomId, input) {
      const thread = await repos.threads.get(roomId);
      if (!thread || thread.kind !== 'room') return undefined;
      const current = new Set((await repos.rooms.listMembers(roomId)).map((member) => member.botId));
      const remove = input.remove ?? [];
      if (thread.leadBotId !== undefined && remove.includes(thread.leadBotId)) {
        throw new RuleViolation('the lead bot cannot leave its room');
      }
      const next = new Set(current);
      for (const botId of input.add ?? []) next.add(botId);
      for (const botId of remove) next.delete(botId);
      if (next.size < MIN_ROOM_BOTS || next.size > MAX_ROOM_BOTS) {
        throw new RuleViolation(`a room holds ${MIN_ROOM_BOTS} to ${MAX_ROOM_BOTS} bots, not ${next.size}`);
      }
      const members = await repos.rooms.updateMembers(roomId, input);
      if (members === undefined) return undefined;
      await publishMembers(roomId);
      return members;
    },

    async post(thread, input) {
      const bots = (await memberBots(thread.id)).filter((bot) => !bot.archived);
      const memberIds = new Set(bots.map((bot) => bot.id));
      const mentions = resolveMentions(input.content, bots, input.mentions ?? []);
      const created = await repos.messages.create({
        threadId: thread.id,
        role: 'user',
        content: input.content,
        ...(mentions.length === 0 ? {} : { mentions }),
      });
      let message = created;
      if (input.attachmentIds !== undefined && input.attachmentIds.length > 0) {
        await repos.attachments.linkToMessage(input.attachmentIds, created.id);
        message = (await repos.messages.get(created.id)) ?? created;
      }
      await bus.publish({ type: 'message.completed', threadId: thread.id, message });

      const responder = thread.responder ?? 'lead';
      const baton = batons.get(thread.id);
      const batonHolds = baton !== undefined && memberIds.has(baton);
      const useBaton = mentions.length === 0 && responder === 'lead' && batonHolds;
      if (useBaton || (baton !== undefined && !batonHolds)) batons.delete(thread.id);
      const responders = chooseResponders({
        responder,
        mentions,
        leadBotId: thread.leadBotId ?? thread.botId,
        ...(useBaton && baton !== undefined ? { baton } : {}),
      });
      return { runId: await startReplies(thread.id, message, responders), message };
    },

    async setBaton(threadId, toBotId) {
      const thread = await repos.threads.get(threadId);
      if (!thread || thread.kind !== 'room') throw new RuleViolation('a baton can only pass within a room');
      const memberIds = new Set((await repos.rooms.listMembers(threadId)).map((member) => member.botId));
      if (!memberIds.has(toBotId)) throw new RuleViolation('the baton can only pass to a room member');
      batons.set(threadId, toBotId);
    },
  };
}
