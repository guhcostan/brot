import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalMode,
  ApprovalStatus,
  CanonicalEventType,
  ComputerKind,
  ComputerState,
  DeviceRole,
  EgressPolicy,
  MemoryKind,
  McpServerTransport,
  NotificationKind,
  MessageRole,
  PolicyEffect,
  ResponderMode,
  RoutineRunStatus,
  RoutineRunTrigger,
  RoutineTrigger,
  RunStatus,
  TaskStatus,
  ThreadKind,
} from '@brot/protocol';

type JsonObject = Record<string, unknown>;

export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  job: text('job').notNull(),
  instructions: text('instructions').notNull(),
  avatar: text('avatar'),
  engine: text('engine').notNull(),
  model: text('model'),
  computer: text('computer').$type<ComputerKind>().notNull(),
  desktop: integer('desktop', { mode: 'boolean' }).notNull().default(false),
  browser: integer('browser', { mode: 'boolean' }).notNull().default(false),
  /**
   * The shared browser profile the bot browses with. Plain text, not a foreign key: deleting a profile
   * ungroups its bots instead of touching them. Absent means the bot's own profile.
   */
  browserProfileId: text('browser_profile_id'),
  notifications: integer('notifications', { mode: 'boolean' }).notNull().default(true),
  /** Whether the chat may speak this bot's replies. */
  speakReplies: integer('speak_replies', { mode: 'boolean' }).notNull().default(false),
  /** How the broker treats write actions: `ask` pauses all of them, `edits` only the irreversible kinds. */
  approvalMode: text('approval_mode').$type<ApprovalMode>().notNull().default('ask'),
  /** The bot's team. Plain text, not a foreign key: deleting a team ungroups its bots instead of touching them. */
  teamId: text('team_id'),
  egress: text('egress', { mode: 'json' })
    .$type<EgressPolicy>()
    .notNull()
    .default(sql`'{"mode":"deny","allow":[]}'`),
  teamBudgetUsd: real('team_budget_usd'),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** A named group of bots with a shared brief, shown to every member bot's prompt. */
export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  instructions: text('instructions').notNull(),
  chiefBotId: text('chief_bot_id').references(() => bots.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** A signed-in Chrome profile on the server machine, optionally shared by several bots. */
export const browserProfiles = sqliteTable('browser_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * DMs and rooms. `botId` is the bot the DM talks to, or the lead bot of a room. `engineSessionId` is the
 * DM's engine session. Rooms keep one engine session per bot in `thread_sessions`, not here.
 */
export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** A `<provider>/<model>` override for this thread. Null means the bot's model. DMs only. */
    model: text('model'),
    engineSessionId: text('engine_session_id'),
    kind: text('kind').$type<ThreadKind>().notNull().default('dm'),
    leadBotId: text('lead_bot_id').references(() => bots.id, { onDelete: 'cascade' }),
    responder: text('responder').$type<ResponderMode>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('threads_bot_idx').on(t.botId)],
);

export const computers = sqliteTable(
  'computers',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    state: text('state').$type<ComputerState>().notNull(),
    image: text('image').notNull(),
    error: text('error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('computers_bot_uq').on(t.botId)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    role: text('role').$type<MessageRole>().notNull(),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull(),
    authorBotId: text('author_bot_id').references(() => bots.id, { onDelete: 'set null' }),
    /** Bot ids @mentioned in the message. Not a foreign key: a deleted bot leaves a stale id, which is harmless. */
    mentions: text('mentions', { mode: 'json' }).$type<string[]>(),
    viaBotId: text('via_bot_id').references(() => bots.id, { onDelete: 'set null' }),
  },
  (t) => [index('messages_thread_idx').on(t.threadId)],
);

/**
 * A file attached to a message. The bytes live in `<BROT_HOME>/attachments/<id>`, written with mode 0600;
 * this row is the metadata. `message_id` is null until the message that carries it is stored.
 */
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('attachments_thread_idx').on(t.threadId), index('attachments_message_idx').on(t.messageId)],
);

/**
 * One inbox entry. Approvals and failed runs always create one; a finished run only when the bot allows
 * notifications. Deleting the bot or its thread cascades the entries away.
 */
export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<NotificationKind>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    readAt: text('read_at'),
  },
  (t) => [index('notifications_read_idx').on(t.readAt, t.createdAt), index('notifications_bot_idx').on(t.botId)],
);

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    status: text('status').$type<RunStatus>().notNull(),
    engine: text('engine').notNull(),
    model: text('model'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    error: text('error'),
  },
  // The usage range query scans by startedAt; the thread lookup has its own index.
  (t) => [index('runs_thread_idx').on(t.threadId), index('runs_started_idx').on(t.startedAt)],
);

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ApprovalKind>().notNull(),
    tool: text('tool').notNull(),
    summary: text('summary').notNull(),
    args: text('args', { mode: 'json' }).$type<JsonObject>().notNull(),
    status: text('status').$type<ApprovalStatus>().notNull(),
    decision: text('decision').$type<ApprovalDecision>(),
    reply: text('reply'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (t) => [index('approvals_status_idx').on(t.status)],
);

export const policies = sqliteTable(
  'policies',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    tool: text('tool').notNull(),
    argPattern: text('arg_pattern'),
    effect: text('effect').$type<PolicyEffect>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('policies_bot_idx').on(t.botId)],
);

export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MemoryKind>().notNull(),
    content: text('content').notNull(),
    sourceRunId: text('source_run_id').references(() => runs.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('memories_bot_idx').on(t.botId)],
);

export const skills = sqliteTable(
  'skills',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id').references(() => bots.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    body: text('body').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('skills_bot_idx').on(t.botId)],
);

export const routines = sqliteTable(
  'routines',
  {
    id: text('id').primaryKey(),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    instruction: text('instruction').notNull(),
    trigger: text('trigger', { mode: 'json' }).$type<RoutineTrigger>().notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    catchUp: integer('catch_up', { mode: 'boolean' }).notNull().default(true),
    rememberLastRun: integer('remember_last_run', { mode: 'boolean' }).notNull().default(false),
    lastRunAt: text('last_run_at'),
    nextRunAt: text('next_run_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('routines_bot_idx').on(t.botId)],
);

/** One run of a routine: the engine run it started, the trigger, and how it ended. Rows cascade with the routine. */
export const routineRuns = sqliteTable(
  'routine_runs',
  {
    id: text('id').primaryKey(),
    routineId: text('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    trigger: text('trigger').$type<RoutineRunTrigger>().notNull(),
    status: text('status').$type<RoutineRunStatus>().notNull(),
    result: text('result'),
    error: text('error'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('routine_runs_routine_idx').on(t.routineId), index('routine_runs_started_idx').on(t.startedAt)],
);

export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    role: text('role').$type<DeviceRole>().notNull(),
    publicKey: text('public_key').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at'),
  },
  (t) => [uniqueIndex('devices_token_hash_uq').on(t.tokenHash)],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
    type: text('type').$type<CanonicalEventType>().notNull(),
    payload: text('payload', { mode: 'json' }).$type<JsonObject>().notNull(),
    at: text('at').notNull(),
  },
  (t) => [index('events_thread_at_idx').on(t.threadId, t.at)],
);

/** A bot's membership in a room thread. The lead bot is a member too. */
export const roomMembers = sqliteTable(
  'room_members',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    joinedAt: text('joined_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.botId] })],
);

/**
 * One engine session per bot per thread. Rooms use this table so each member resumes its own session.
 * `engineSessionId` is null after a reset. The row stays so `updatedAt` still says when it changed.
 */
export const threadSessions = sqliteTable(
  'thread_sessions',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    botId: text('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    engineSessionId: text('engine_session_id'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.botId] })],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').$type<TaskStatus>().notNull(),
    assigneeBotId: text('assignee_bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    createdByBotId: text('created_by_bot_id').references(() => bots.id, { onDelete: 'set null' }),
    createdByUser: integer('created_by_user', { mode: 'boolean' }).notNull(),
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'set null' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    workThreadId: text('work_thread_id').references(() => threads.id, { onDelete: 'set null' }),
    workRunId: text('work_run_id').references(() => runs.id, { onDelete: 'set null' }),
    result: text('result'),
    chainId: text('chain_id').notNull(),
    depth: integer('depth').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('tasks_assignee_idx').on(t.assigneeBotId),
    index('tasks_chain_idx').on(t.chainId),
    index('tasks_thread_idx').on(t.threadId),
    index('tasks_parent_idx').on(t.parentTaskId),
  ],
);

/**
 * A login the person saved for a site. The three `*_secret` columns hold vault secret names (the values stay in
 * the vault), so this table never contains a username, password or TOTP secret in plaintext.
 */
export const savedLogins = sqliteTable('saved_logins', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  host: text('host').notNull(),
  label: text('label'),
  usernameSecret: text('username_secret').notNull(),
  passwordSecret: text('password_secret').notNull(),
  totpSecret: text('totp_secret'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * A user MCP server. Brot attaches every enabled one to a run next to its own MCP server. `env` holds
 * configuration and `secret://` references only; the vault resolves a reference into the child process
 * when it is spawned, so a value is never stored in this row.
 */
export const mcpServers = sqliteTable(
  'mcp_servers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    transport: text('transport').$type<McpServerTransport>().notNull(),
    command: text('command'),
    args: text('args', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    env: text('env', { mode: 'json' }).$type<Record<string, string>>().notNull().default(sql`'{}'`),
    url: text('url'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('mcp_servers_name_uq').on(t.name)],
);

/**
 * Generic server settings: one JSON value per key. The voice settings live under `voice`; adding another
 * setting needs no migration. Read values with the schema that owns the key (see `repos.settings.get`).
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
});
