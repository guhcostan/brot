import { z } from 'zod';
import { defaultEgressPolicy, EgressPolicy } from './egress';
import { MAX_ROOM_BOTS, MIN_ROOM_BOTS } from './constants';
import {
  ApprovalDecision,
  ComputerKind,
  DeviceRole,
  IsoDateTime,
  MemoryKind,
  PolicyEffect,
  ResponderMode,
  RoutineTrigger,
  TaskStatus,
} from './entities';

/** `computer: 'host'` runs tools on the Brot host machine, so it must be opted into explicitly. */
function requireHostAcknowledgement(
  value: { computer?: ComputerKind; hostAcknowledged?: boolean },
  ctx: z.RefinementCtx,
): void {
  if (value.computer === 'host' && value.hostAcknowledged !== true) {
    ctx.addIssue({
      code: 'custom',
      path: ['hostAcknowledged'],
      message: 'computer "host" runs on the host machine and needs hostAcknowledged: true',
    });
  }
}

export const CreateBot = z
  .object({
    name: z.string().min(1),
    job: z.string().min(1),
    instructions: z.string().default(''),
    engine: z.string().min(1).default('mock'),
    model: z.string().min(1).optional(),
    computer: ComputerKind.default('sandbox'),
    avatar: z.string().optional(),
    egress: EgressPolicy.default(defaultEgressPolicy),
    teamBudgetUsd: z.number().nonnegative().optional(),
    hostAcknowledged: z.boolean().optional(),
  })
  .superRefine(requireHostAcknowledgement);
export type CreateBot = z.infer<typeof CreateBot>;
export type CreateBotInput = z.input<typeof CreateBot>;

export const UpdateBot = z
  .object({
    name: z.string().min(1).optional(),
    job: z.string().min(1).optional(),
    instructions: z.string().optional(),
    avatar: z.string().optional(),
    engine: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    computer: ComputerKind.optional(),
    egress: EgressPolicy.optional(),
    /** `null` removes the cap. */
    teamBudgetUsd: z.number().nonnegative().nullable().optional(),
    hostAcknowledged: z.boolean().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .superRefine(requireHostAcknowledgement);
export type UpdateBot = z.infer<typeof UpdateBot>;

export const CreateThread = z.object({
  title: z.string().min(1).optional(),
});
export type CreateThread = z.infer<typeof CreateThread>;

/** Rejects a bot list that names the same bot twice. */
function requireUniqueBots(bots: string[], ctx: z.RefinementCtx, path: string[]): void {
  if (new Set(bots).size !== bots.length) {
    ctx.addIssue({ code: 'custom', path, message: 'a bot may appear only once' });
  }
}

/**
 * A message from the user. `mentions` names the bots it @mentions, by id. Each bot appears once, and a
 * message names at most a room's worth of bots.
 */
export const PostMessage = z
  .object({
    content: z.string().min(1),
    mentions: z.array(z.string().min(1)).max(MAX_ROOM_BOTS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mentions) requireUniqueBots(value.mentions, ctx, ['mentions']);
  });
export type PostMessage = z.infer<typeof PostMessage>;

export const CreateRoom = z
  .object({
    title: z.string().min(1),
    botIds: z.array(z.string().min(1)).min(MIN_ROOM_BOTS).max(MAX_ROOM_BOTS),
    leadBotId: z.string().min(1),
    responder: ResponderMode.default('lead'),
  })
  .superRefine((value, ctx) => {
    requireUniqueBots(value.botIds, ctx, ['botIds']);
    if (!value.botIds.includes(value.leadBotId)) {
      ctx.addIssue({ code: 'custom', path: ['leadBotId'], message: 'the lead bot must be one of botIds' });
    }
  });
export type CreateRoom = z.infer<typeof CreateRoom>;
export type CreateRoomInput = z.input<typeof CreateRoom>;

/**
 * Adds and removes room members. The repository refuses a result outside `MIN_ROOM_BOTS..MAX_ROOM_BOTS`
 * and refuses to remove the lead bot.
 */
export const UpdateRoomMembers = z
  .object({
    add: z.array(z.string().min(1)).max(MAX_ROOM_BOTS).optional(),
    remove: z.array(z.string().min(1)).max(MAX_ROOM_BOTS).optional(),
  })
  .superRefine((value, ctx) => {
    const add = value.add ?? [];
    const remove = value.remove ?? [];
    if (add.length === 0 && remove.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'name at least one bot to add or remove' });
    }
    requireUniqueBots(add, ctx, ['add']);
    requireUniqueBots(remove, ctx, ['remove']);
    if (add.some((botId) => remove.includes(botId))) {
      ctx.addIssue({ code: 'custom', message: 'a bot cannot be added and removed in one request' });
    }
  });
export type UpdateRoomMembers = z.infer<typeof UpdateRoomMembers>;

/**
 * Creates a task. A user creates a root task (depth 0) by leaving out `createdByBotId`. A bot that
 * delegates sets `createdByBotId`, and may name the task it works under as `parentTaskId`.
 */
export const CreateTask = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    assigneeBotId: z.string().min(1),
    threadId: z.string().min(1),
    createdByBotId: z.string().min(1).optional(),
    parentTaskId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.parentTaskId !== undefined && value.createdByBotId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentTaskId'],
        message: 'a user-created task is a chain root; name createdByBotId to delegate under a task',
      });
    }
    if (value.createdByBotId !== undefined && value.createdByBotId === value.assigneeBotId) {
      ctx.addIssue({ code: 'custom', path: ['assigneeBotId'], message: 'a bot cannot delegate a task to itself' });
    }
  });
export type CreateTask = z.infer<typeof CreateTask>;
export type CreateTaskInput = z.input<typeof CreateTask>;

/**
 * Updates a task. `workThreadId` and `workRunId` are written by the server when the assignee starts working.
 * `workRunId` lets a cancel stop the run that does the work.
 */
export const UpdateTask = z
  .object({
    status: TaskStatus.optional(),
    result: z.string().optional(),
    assigneeBotId: z.string().min(1).optional(),
    workThreadId: z.string().min(1).optional(),
    workRunId: z.string().min(1).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'expected at least one field to update',
  });
export type UpdateTask = z.infer<typeof UpdateTask>;

export const ResolveApproval = z.object({
  decision: ApprovalDecision,
  reply: z.string().optional(),
});
export type ResolveApproval = z.infer<typeof ResolveApproval>;

export const CreateMemory = z.object({
  kind: MemoryKind,
  content: z.string(),
});
export type CreateMemory = z.infer<typeof CreateMemory>;

export const UpdateMemory = z.object({
  content: z.string().optional(),
  kind: MemoryKind.optional(),
});
export type UpdateMemory = z.infer<typeof UpdateMemory>;

export const CreateSkill = z.object({
  name: z.string().min(1),
  description: z.string(),
  body: z.string(),
  botId: z.string().optional(),
});
export type CreateSkill = z.infer<typeof CreateSkill>;

export const UpdateSkill = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  botId: z.string().optional(),
});
export type UpdateSkill = z.infer<typeof UpdateSkill>;

export const CreateRoutine = z.object({
  botId: z.string(),
  name: z.string().min(1),
  instruction: z.string(),
  trigger: RoutineTrigger,
  enabled: z.boolean().default(true),
});
export type CreateRoutine = z.infer<typeof CreateRoutine>;
export type CreateRoutineInput = z.input<typeof CreateRoutine>;

export const UpdateRoutine = z.object({
  name: z.string().min(1).optional(),
  instruction: z.string().optional(),
  trigger: RoutineTrigger.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateRoutine = z.infer<typeof UpdateRoutine>;

export const CreatePolicy = z.object({
  tool: z.string().min(1),
  argPattern: z.string().optional(),
  effect: PolicyEffect,
});
export type CreatePolicy = z.infer<typeof CreatePolicy>;

export const PairingStartResponse = z.object({
  token: z.string(),
  code: z.string(),
  expiresAt: IsoDateTime,
  qrPayload: z.string(),
});
export type PairingStartResponse = z.infer<typeof PairingStartResponse>;

export const PairingComplete = z.object({
  token: z.string().min(1),
  deviceName: z.string().min(1),
  publicKey: z.string().min(1),
  role: DeviceRole.default('full'),
});
export type PairingComplete = z.infer<typeof PairingComplete>;

export const PairingCompleteResponse = z.object({
  deviceId: z.string(),
  deviceToken: z.string(),
});
export type PairingCompleteResponse = z.infer<typeof PairingCompleteResponse>;
