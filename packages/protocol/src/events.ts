import { z } from 'zod';
import { Approval, ComputerState, IsoDateTime, Memory, Message, Task } from './entities';

const base = {
  id: z.string(),
  at: IsoDateTime,
  threadId: z.string(),
  runId: z.string().optional(),
};

/**
 * A blocked-egress host name. Only the host is recorded, never a URL, so paths and query strings
 * (which can carry tokens) stay out of the log. IP literals are allowed here: a blocked attempt can
 * target any address.
 */
const BlockedHost = z
  .string()
  .min(1)
  .max(253)
  .refine((host) => !/[\s/?#@]/.test(host), 'expected a bare host, not a URL');

export const CanonicalEvent = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('run.started'),
    botId: z.string(),
    engine: z.string(),
    model: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('message.delta'),
    messageId: z.string(),
    delta: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('message.completed'),
    message: Message,
  }),
  z.object({
    ...base,
    type: z.literal('tool.call'),
    callId: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...base,
    type: z.literal('tool.result'),
    callId: z.string(),
    ok: z.boolean(),
    output: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('approval.requested'),
    approval: Approval,
  }),
  z.object({
    ...base,
    type: z.literal('approval.resolved'),
    approval: Approval,
  }),
  z.object({
    ...base,
    type: z.literal('memory.written'),
    memory: Memory,
  }),
  z.object({
    ...base,
    type: z.literal('cost.updated'),
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  /**
   * Computer lifecycle. The log is per thread, so `threadId` is the thread whose request or run caused
   * the change (for an idle stop, the bot's most recent thread).
   */
  z.object({
    ...base,
    type: z.literal('computer.status'),
    computerId: z.string(),
    botId: z.string(),
    state: ComputerState,
    reason: z.string().optional(),
  }),
  /**
   * The bot's computer tried to reach `host`, which its egress policy does not allow.
   * The event's `at` is the time of the attempt.
   */
  z.object({
    ...base,
    type: z.literal('network.blocked'),
    botId: z.string(),
    host: BlockedHost,
  }),
  /** A team task was created. The event's `threadId` is the thread where it was requested. */
  z.object({
    ...base,
    type: z.literal('task.created'),
    task: Task,
  }),
  /** A team task changed status, result, assignee, or work thread. Carries the whole task after the change. */
  z.object({
    ...base,
    type: z.literal('task.updated'),
    task: Task,
  }),
  /**
   * A room baton pass: `fromBotId` hands the conversation to `toBotId`. Shown in the room's timeline, and
   * `toBotId` becomes the bot that answers next.
   */
  z.object({
    ...base,
    type: z.literal('handoff'),
    fromBotId: z.string(),
    toBotId: z.string(),
    note: z.string().optional(),
  }),
  /**
   * A bot asked another bot a question, and is waiting for the answer. `askId` links it to the matching
   * `bot.answered`. The event's `threadId` is the thread where the exchange is shown.
   */
  z.object({
    ...base,
    type: z.literal('bot.asked'),
    fromBotId: z.string(),
    toBotId: z.string(),
    question: z.string(),
    askId: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('bot.answered'),
    askId: z.string(),
    fromBotId: z.string(),
    toBotId: z.string(),
    answer: z.string(),
  }),
  /** The members of a room after a change. Lists every member, not only the added or removed ones. */
  z.object({
    ...base,
    type: z.literal('room.members'),
    botIds: z.array(z.string()),
  }),
  z.object({
    ...base,
    type: z.literal('run.completed'),
  }),
  z.object({
    ...base,
    type: z.literal('run.failed'),
    error: z.string(),
  }),
]);
export type CanonicalEvent = z.infer<typeof CanonicalEvent>;
export type CanonicalEventType = CanonicalEvent['type'];

export function parseEvent(input: unknown): CanonicalEvent {
  return CanonicalEvent.parse(input);
}
