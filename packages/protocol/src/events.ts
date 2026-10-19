import { z } from 'zod';
import { Approval, IsoDateTime, Memory, Message } from './entities';

const base = {
  id: z.string(),
  at: IsoDateTime,
  threadId: z.string(),
  runId: z.string().optional(),
};

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
