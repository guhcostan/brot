import { z } from 'zod';
import { EgressPolicy } from './egress';
import { TEAM_MAX_DEPTH } from './constants';
import { ATTACHMENT_NAME_MAX_LENGTH } from './attachments';

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

/**
 * A named group of bots with a shared brief. Every member bot gets the team's name and `instructions`
 * in its prompt. `chiefBotId` is the bot that leads it.
 */
export const Team = z.object({
  id: z.string(),
  name: z.string(),
  /** The team's shared brief, given to every member bot's prompt. */
  instructions: z.string(),
  /** The bot that leads the team. Absent until a chief is set, and after the chief bot is deleted. */
  chiefBotId: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Team = z.infer<typeof Team>;

/**
 * A browser profile on the server machine, holding the logins a person saved in it. A bot either browses with
 * its own profile (the default) or names a shared one, so several bots use the same signed-in session.
 */
export const BrowserProfile = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BrowserProfile = z.infer<typeof BrowserProfile>;

/**
 * How a bot handles risky tool calls. `ask` pauses every risky action for a person. `edits` lets the bot
 * change its own computer freely (shell, file writes and other write actions) while everything irreversible
 * still asks.
 */
export const ApprovalMode = z.enum(['ask', 'edits']);
export type ApprovalMode = z.infer<typeof ApprovalMode>;

export const Bot = z.object({
  id: z.string(),
  name: z.string(),
  job: z.string(),
  instructions: z.string(),
  avatar: z.string().optional(),
  /** The team this bot belongs to. Absent for an ungrouped bot. */
  teamId: z.string().optional(),
  engine: z.string(),
  model: z.string().optional(),
  computer: ComputerKind,
  /**
   * With `computer: 'sandbox'`, gives the computer a screen: a Linux desktop with a browser that the
   * bot drives and the user can watch live and take over. Absent means a headless sandbox.
   */
  desktop: z.boolean().optional(),
  /**
   * A browser on the server machine with the bot's own persistent profile, so logins survive restarts.
   * Independent of `computer`: a `none` bot with `browser: true` can still browse. Browsing is subject to
   * the bot's `egress` policy.
   */
  browser: z.boolean().optional(),
  /**
   * The shared browser profile this bot browses with. Absent means its own profile, which is private to the
   * bot. Bots that name the same profile share one Chrome and every login in it.
   */
  browserProfileId: z.string().optional(),
  /**
   * Whether finished runs post an inbox notification. Absent means true. Approvals and failed runs always
   * notify, because those need a person.
   */
  notifications: z.boolean().optional(),
  /**
   * How the bot handles approvals. Absent means `ask`. In `edits` mode the broker auto-allows shell, file
   * writes and other write actions; send, publish, delete, purchase and permission changes always ask.
   */
  approvalMode: ApprovalMode.optional(),
  /** Absent means deny-all. Stored bots always carry a policy; the default is `{ mode: 'deny', allow: [] }`. */
  egress: EgressPolicy.optional(),
  /**
   * Cost cap in USD for one team chain (every task that shares a `chainId`) this bot takes part in.
   * When several bots in a chain set one, the smallest applies. Absent means no cap.
   */
  teamBudgetUsd: z.number().nonnegative().optional(),
  pinned: z.boolean(),
  archived: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Bot = z.infer<typeof Bot>;

export const ThreadKind = z.enum(['dm', 'room']);
export type ThreadKind = z.infer<typeof ThreadKind>;

/**
 * Who answers in a room.
 * - `mention`: only the bots @mentioned in a message answer.
 * - `lead`: the mentioned bots answer. When nobody is mentioned, the lead bot answers and may hand the
 *   message to another member.
 */
export const ResponderMode = z.enum(['mention', 'lead']);
export type ResponderMode = z.infer<typeof ResponderMode>;

/**
 * A conversation: a DM with one bot (`kind: 'dm'`) or a room with several bots (`kind: 'room'`).
 * For a room, `botId` repeats `leadBotId` so code that expects one bot per thread keeps working.
 */
export const Thread = z.object({
  id: z.string(),
  botId: z.string(),
  title: z.string(),
  /** Absent means `dm`. The server always sends it. */
  kind: ThreadKind.optional(),
  /** The bot that created the room and answers when nobody is mentioned. Rooms only. */
  leadBotId: z.string().optional(),
  /** Rooms only. Absent on DMs. */
  responder: ResponderMode.optional(),
  /**
   * The engine session to resume for a DM, as last reported through the `engine.session` event.
   * Rooms keep one session per bot in `thread_sessions` instead, and leave this unset.
   */
  engineSessionId: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Thread = z.infer<typeof Thread>;

/** A bot's membership in a room. The lead bot is a member too. */
export const RoomMember = z.object({
  threadId: z.string(),
  botId: z.string(),
  joinedAt: IsoDateTime,
});
export type RoomMember = z.infer<typeof RoomMember>;

/**
 * Status of a team task. `open` waits for its assignee, `in_progress` is being worked, and `blocked`
 * waits on someone else. `done`, `failed` and `cancelled` end the task.
 */
export const TaskStatus = z.enum(['open', 'in_progress', 'blocked', 'done', 'failed', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * A unit of team work. A user creates a task at depth 0. A bot that delegates creates a child at
 * `parent.depth + 1`, or at depth 1 when it names no parent. A task shares its chain's `chainId`, and a
 * user-created task starts its chain with its own id.
 */
export const Task = z
  .object({
    id: z.string(),
    title: z.string().min(1),
    description: z.string().optional(),
    status: TaskStatus,
    assigneeBotId: z.string(),
    /** The bot that delegated the task. Absent for user-created tasks, and for tasks whose creator was deleted. */
    createdByBotId: z.string().optional(),
    createdByUser: z.boolean(),
    parentTaskId: z.string().optional(),
    /** The thread where the task was requested. */
    threadId: z.string(),
    /** The assignee's DM thread where the work happens. Set when the assignee starts. */
    workThreadId: z.string().optional(),
    /** The run doing the assignee's work, set when the work starts. Cancelling the task stops this run. */
    workRunId: z.string().optional(),
    result: z.string().optional(),
    chainId: z.string(),
    depth: z.number().int().min(0).max(TEAM_MAX_DEPTH),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .superRefine((task, ctx) => {
    if (task.createdByUser) {
      if (task.depth !== 0) {
        ctx.addIssue({ code: 'custom', path: ['depth'], message: 'a user-created task is depth 0' });
      }
      if (task.createdByBotId !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['createdByBotId'], message: 'a user-created task has no creator bot' });
      }
      if (task.parentTaskId !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['parentTaskId'], message: 'a user-created task is a chain root' });
      }
      if (task.chainId !== task.id) {
        ctx.addIssue({ code: 'custom', path: ['chainId'], message: 'a user-created task starts its chain with its own id' });
      }
    } else if (task.depth < 1) {
      ctx.addIssue({ code: 'custom', path: ['depth'], message: 'a delegated task is depth 1 or more' });
    }
  });
export type Task = z.infer<typeof Task>;

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

/**
 * The person at the keyboard of a bot's desktop. While a takeover is active the bot's browser and
 * input tools refuse with a "the person has control" result, and only the user's input reaches the screen.
 */
export const Takeover = z.object({
  botId: z.string(),
  active: z.boolean(),
  /** Why control moved: the bot asked for help (sign-in, CAPTCHA, 2FA) or the person took it. */
  reason: z.string().max(500).optional(),
  requestedBy: z.enum(['bot', 'user']).optional(),
  at: IsoDateTime,
});
export type Takeover = z.infer<typeof Takeover>;

/**
 * The person watching a bot's host browser and, while `active`, driving it (a sign-in, a CAPTCHA, a 2FA code).
 * The state belongs to a browser profile, so every bot sharing that profile sees the same takeover.
 */
export const BrowserTakeover = z.object({
  active: z.boolean(),
  /** When the person took control. Absent once they hand it back. */
  since: IsoDateTime.optional(),
  reason: z.string().max(500).optional(),
});
export type BrowserTakeover = z.infer<typeof BrowserTakeover>;

export const MessageRole = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof MessageRole>;

/** An image is shown as a note; a file is anything else the chat accepts (text, JSON, PDF, ZIP). */
export const AttachmentKind = z.enum(['image', 'file']);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

/**
 * A file a person attached to a message. The bytes live in the server's attachment storage; this is only the
 * metadata the API and the run see. `messageId` is absent until the message carrying it is stored.
 */
export const Attachment = z.object({
  id: z.string(),
  name: z.string().min(1).max(ATTACHMENT_NAME_MAX_LENGTH),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  kind: AttachmentKind,
  createdAt: IsoDateTime,
  /** The message this attachment was linked to. Absent for a fresh upload. */
  messageId: z.string().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

export const Message = z.object({
  id: z.string(),
  threadId: z.string(),
  role: MessageRole,
  content: z.string(),
  createdAt: IsoDateTime,
  /** The bot that wrote an assistant message. Absent on older rows, where it is the thread's bot. */
  authorBotId: z.string().optional(),
  /** Bot ids @mentioned in the message. */
  mentions: z.array(z.string()).optional(),
  /**
   * For a message one bot posts to another, the bot it was addressed to. `authorBotId` is the sender,
   * so the UI can render "sender → recipient".
   */
  viaBotId: z.string().optional(),
  /** Files attached to this message, in upload order. Absent on messages without any. */
  attachments: z.array(Attachment).optional(),
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
  /** `timezone` is an IANA name; the server validates it with croner before it is stored. */
  z.object({ type: z.literal('cron'), cron: z.string(), timezone: z.string().min(1).optional() }),
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
  /** Fire one missed occurrence (within the 12h catch-up window) after downtime. Defaults to true. */
  catchUp: z.boolean().optional(),
  /** Prepend the last completed run's result to the instruction. Defaults to false. */
  rememberLastRun: z.boolean().optional(),
  lastRunAt: IsoDateTime.optional(),
  nextRunAt: IsoDateTime.optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Routine = z.infer<typeof Routine>;

/** How a routine run was started. */
export const RoutineRunTrigger = z.enum(['schedule', 'webhook', 'manual']);
export type RoutineRunTrigger = z.infer<typeof RoutineRunTrigger>;

/**
 * Where a routine run is. `queued` and `running` are active; `completed` ran, `failed` broke, `missed` was not
 * fired, `skipped` found another run of the routine active, and `cancelled` was stopped.
 */
export const RoutineRunStatus = z.enum(['queued', 'running', 'completed', 'failed', 'missed', 'skipped', 'cancelled']);
export type RoutineRunStatus = z.infer<typeof RoutineRunStatus>;

/**
 * One run of a routine. `runId` is the engine run it started, absent until it starts and for runs that never
 * did. `result` is the assistant's final text of a completed run.
 */
export const RoutineRun = z.object({
  id: z.string(),
  routineId: z.string(),
  botId: z.string(),
  threadId: z.string(),
  runId: z.string().optional(),
  trigger: RoutineRunTrigger,
  status: RoutineRunStatus,
  result: z.string().optional(),
  error: z.string().optional(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.optional(),
  createdAt: IsoDateTime,
});
export type RoutineRun = z.infer<typeof RoutineRun>;

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
