import { z } from 'zod';
import { Approval, ComputerState, IsoDateTime, Memory, Message } from './entities';

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
