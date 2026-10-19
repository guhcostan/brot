import { z } from 'zod';
import { EgressPolicy } from './egress';

export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/**
 * Where a bot's tools run.
 * - `sandbox`: a per-bot container, the bot's computer. Shell and file tools run there freely because it
 *   is disposable, and its network is limited by the bot's `egress` policy. Default for new bots.
 * - `none`: no shell or filesystem tools. The bot has only Brot MCP tools.
 * - `host`: runs on the machine that runs Brot. Desktop only, and only with explicit opt-in
 *   (`hostAcknowledged` on CreateBot/UpdateBot). Container isolation and egress limits do not apply.
 */
export const ComputerKind = z.enum(['none', 'sandbox', 'host']);
export type ComputerKind = z.infer<typeof ComputerKind>;

export const Bot = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  instructions: z.string(),
  avatar: z.string().optional(),
  engine: z.string(),
  model: z.string().optional(),
  computer: ComputerKind,
  /** Absent means deny-all. Stored bots always carry a policy; the default is `{ mode: 'deny', allow: [] }`. */
  egress: EgressPolicy.optional(),
  pinned: z.boolean(),
  archived: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Bot = z.infer<typeof Bot>;

export const Thread = z.object({
  id: z.string(),
  botId: z.string(),
  title: z.string(),
  /** The engine session to resume for this thread, as last reported through the `engine.session` event. */
  engineSessionId: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Thread = z.infer<typeof Thread>;

export const ComputerState = z.enum(['stopped', 'starting', 'ready', 'error']);
export type ComputerState = z.infer<typeof ComputerState>;

/** A bot's computer: the sandbox container behind `computer: 'sandbox'`. One per bot. */
export const Computer = z.object({
  id: z.string(),
  botId: z.string(),
  state: ComputerState,
  image: z.string().min(1),
  error: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Computer = z.infer<typeof Computer>;

/** Writes a bot's computer state. The repository creates the record the first time it is written. */
export const ComputerStateUpdate = z.object({
  state: ComputerState,
  image: z.string().min(1),
  error: z.string().optional(),
});
export type ComputerStateUpdate = z.infer<typeof ComputerStateUpdate>;

export const MessageRole = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRole>;

export const Message = z.object({
  id: z.string(),
  threadId: z.string(),
  role: MessageRole,
  content: z.string(),
  createdAt: IsoDateTime,
});
export type Message = z.infer<typeof Message>;

export const RunStatus = z.enum(['running', 'waiting_approval', 'completed', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

export const Run = z.object({
  id: z.string(),
  threadId: z.string(),
  botId: z.string(),
  status: RunStatus,
  engine: z.string(),
  model: z.string().optional(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.optional(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  error: z.string().optional(),
});
export type Run = z.infer<typeof Run>;

export const ApprovalKind = z.enum([
  'shell',
  'file_write',
  'send',
  'publish',
  'delete',
  'purchase',
  'permission',
  'other',
]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalDecision = z.enum(['allow_once', 'allow_always', 'deny']);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalStatus = z.enum(['pending', 'allowed', 'denied']);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const Approval = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  botId: z.string(),
  kind: ApprovalKind,
  tool: z.string(),
  summary: z.string(),
  args: z.record(z.string(), z.unknown()),
  status: ApprovalStatus,
  decision: ApprovalDecision.optional(),
  reply: z.string().optional(),
  createdAt: IsoDateTime,
  resolvedAt: IsoDateTime.optional(),
});
export type Approval = z.infer<typeof Approval>;

export const PolicyEffect = z.enum(['allow', 'deny']);
export type PolicyEffect = z.infer<typeof PolicyEffect>;

export const Policy = z.object({
  id: z.string(),
  botId: z.string(),
  tool: z.string(),
  argPattern: z.string().optional(),
  effect: PolicyEffect,
  createdAt: IsoDateTime,
});
export type Policy = z.infer<typeof Policy>;

export const MemoryKind = z.enum(['fact', 'preference', 'summary']);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const Memory = z.object({
  id: z.string(),
  botId: z.string(),
  kind: MemoryKind,
  content: z.string(),
  sourceRunId: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Memory = z.infer<typeof Memory>;

export const Skill = z.object({
  id: z.string(),
  botId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  body: z.string(),
  version: z.number().int().positive(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Skill = z.infer<typeof Skill>;

export const RoutineTrigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cron'), cron: z.string() }),
  z.object({ type: z.literal('webhook'), secret: z.string() }),
]);
export type RoutineTrigger = z.infer<typeof RoutineTrigger>;

export const Routine = z.object({
  id: z.string(),
  botId: z.string(),
  name: z.string(),
  instruction: z.string(),
  trigger: RoutineTrigger,
  enabled: z.boolean(),
  lastRunAt: IsoDateTime.optional(),
  nextRunAt: IsoDateTime.optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Routine = z.infer<typeof Routine>;

export const DeviceRole = z.enum(['full', 'approver', 'viewer']);
export type DeviceRole = z.infer<typeof DeviceRole>;

export const Device = z.object({
  id: z.string(),
  name: z.string(),
  role: DeviceRole,
  publicKey: z.string(),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime.optional(),
});
export type Device = z.infer<typeof Device>;
