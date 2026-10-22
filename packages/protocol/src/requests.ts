import { z } from 'zod';
import { defaultEgressPolicy, EgressPolicy } from './egress';
import { MAX_ROOM_BOTS, MIN_ROOM_BOTS } from './constants';
import { ATTACHMENT_MAX_PER_MESSAGE } from './attachments';
import {
  ApprovalDecision,
  ComputerKind,
  ComputerState,
  Takeover,
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
    desktop: z.boolean().optional(),
    browser: z.boolean().default(false),
    /** Browse with a shared profile instead of the bot's own. */
    browserProfileId: z.string().min(1).optional(),
    notifications: z.boolean().default(true),
    avatar: z.string().optional(),
    teamId: z.string().min(1).optional(),
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
    desktop: z.boolean().optional(),
    browser: z.boolean().optional(),
    /** A shared profile id, or `null` to go back to the bot's own profile. */
    browserProfileId: z.string().min(1).nullable().optional(),
    notifications: z.boolean().optional(),
    /** `null` removes the bot from its team. */
    teamId: z.string().min(1).nullable().optional(),
    egress: EgressPolicy.optional(),
    /** `null` removes the cap. */
    teamBudgetUsd: z.number().nonnegative().nullable().optional(),
    hostAcknowledged: z.boolean().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .superRefine(requireHostAcknowledgement);
export type UpdateBot = z.infer<typeof UpdateBot>;

/** A named group of bots with a shared brief. `instructions` is empty unless given. */
export const CreateTeam = z.object({
  name: z.string().min(1),
  instructions: z.string().default(''),
  chiefBotId: z.string().min(1).optional(),
});
export type CreateTeam = z.infer<typeof CreateTeam>;
export type CreateTeamInput = z.input<typeof CreateTeam>;

export const UpdateTeam = z.object({
  name: z.string().min(1).optional(),
  instructions: z.string().optional(),
  /** `null` removes the chief. */
  chiefBotId: z.string().min(1).nullable().optional(),
});
export type UpdateTeam = z.infer<typeof UpdateTeam>;

export const CreateThread = z.object({
  title: z.string().min(1).optional(),
});
export type CreateThread = z.infer<typeof CreateThread>;

export const UpdateThread = z.object({
  title: z.string().min(1).max(120),
});
export type UpdateThread = z.infer<typeof UpdateThread>;

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
    /** Attachments uploaded for this message, to be linked to it. */
    attachmentIds: z.array(z.string().min(1)).max(ATTACHMENT_MAX_PER_MESSAGE).optional(),
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
    /**
     * Joins a bot-created root task to an existing chain, so every delegation one run makes shares a chain
     * and its limits. Ignored when `parentTaskId` is given (the parent's chain wins).
     */
    chainId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.chainId !== undefined && value.createdByBotId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['chainId'], message: 'only a delegation joins an existing chain' });
    }
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
  /** Fire one missed occurrence (within 12h) after downtime. */
  catchUp: z.boolean().default(true),
  /** Prepend the last completed run's result to the instruction. */
  rememberLastRun: z.boolean().default(false),
});
export type CreateRoutine = z.infer<typeof CreateRoutine>;
export type CreateRoutineInput = z.input<typeof CreateRoutine>;

export const UpdateRoutine = z.object({
  name: z.string().min(1).optional(),
  instruction: z.string().optional(),
  trigger: RoutineTrigger.optional(),
  enabled: z.boolean().optional(),
  catchUp: z.boolean().optional(),
  rememberLastRun: z.boolean().optional(),
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

/** Screen coordinates, in desktop pixels from the top-left corner. */
const ScreenX = z.number().int().min(0).max(7680);
const ScreenY = z.number().int().min(0).max(4320);

/**
 * One input event from the person who took over a bot's desktop or host browser. `key` uses xdotool key names
 * (`Return`, `ctrl+l`, `BackSpace`). `type` text is sent literally. The host browser reuses this shape; its
 * coordinates are browser viewport pixels (1280x800).
 */
export const ComputerInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: ScreenX, y: ScreenY, button: z.enum(['left', 'middle', 'right']).default('left'), double: z.boolean().default(false) }),
  z.object({ type: z.literal('move'), x: ScreenX, y: ScreenY }),
  z.object({ type: z.literal('type'), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('key'), key: z.string().regex(/^[A-Za-z0-9_+]{1,40}$/) }),
  z.object({ type: z.literal('scroll'), x: ScreenX, y: ScreenY, dy: z.number().int().min(-20).max(20) }),
]);
export type ComputerInput = z.infer<typeof ComputerInput>;

/** Starts or ends a person's takeover of a bot's desktop. */
export const SetTakeover = z.object({
  active: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type SetTakeover = z.infer<typeof SetTakeover>;

/**
 * Starts or ends a person's takeover of a bot's host browser. Like the desktop takeover, but the state belongs
 * to a browser profile, so it applies to every bot that shares the profile.
 */
export const SetBrowserTakeover = z.object({
  active: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type SetBrowserTakeover = z.infer<typeof SetBrowserTakeover>;

/**
 * A profile name as a person types it: trimmed, 1 to 60 characters, one line. Blank names and line breaks are
 * refused because the name is shown in bot forms and one-line lists.
 */
const BrowserProfileName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((name) => !/[\r\n]/.test(name), 'must be a single line');

/** Creates a shared browser profile: one set of logins several bots can use. */
export const CreateBrowserProfile = z.object({ name: BrowserProfileName });
export type CreateBrowserProfile = z.infer<typeof CreateBrowserProfile>;

export const UpdateBrowserProfile = z.object({ name: BrowserProfileName });
export type UpdateBrowserProfile = z.infer<typeof UpdateBrowserProfile>;

/** Which profile serves a bot's host browser: its own, or a shared profile it names. */
export const BrowserProfileRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('own') }),
  z.object({ kind: z.literal('shared'), id: z.string(), name: z.string() }),
]);
export type BrowserProfileRef = z.infer<typeof BrowserProfileRef>;

/**
 * What `GET /api/bots/:id/browser` returns: the bot's host browser and the profile behind it. `login` means a
 * headed window is open for the person to sign in; `state` stays where it was so older clients still read it.
 */
export const BrowserStatus = z.object({
  state: z.enum(['stopped', 'running', 'login']),
  profile: BrowserProfileRef,
});
export type BrowserStatus = z.infer<typeof BrowserStatus>;

/** What `GET /api/bots/:id/computer` returns: the computer's state, whether it has a screen, and who drives it. */
export const ComputerInfo = z.object({
  state: z.union([ComputerState, z.literal('none')]),
  desktop: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  takeover: Takeover.nullable(),
});
export type ComputerInfo = z.infer<typeof ComputerInfo>;
