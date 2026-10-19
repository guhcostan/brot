import { z } from 'zod';

/**
 * How far a tool call can reach outside the bot's computer.
 * - `read`: no change in the outside world (search, list, fetch).
 * - `write`: a change Brot can show and that stays inside Brot (draft, memory, file in the vault).
 * - `irreversible`: sends, posts, pays, deletes, or changes permissions. Always goes through the broker.
 */
export const ToolRisk = z.enum(['read', 'write', 'irreversible']);
export type ToolRisk = z.infer<typeof ToolRisk>;

/** A `secret://name` reference. The broker injects the value at execution time; it never enters model context. */
export const SecretRef = z
  .string()
  .regex(/^secret:\/\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, 'expected secret://<name>');
export type SecretRef = z.infer<typeof SecretRef>;

/**
 * JSON Schema for tool arguments, as `tools/list` returns it. Its root must be an object schema.
 * Servers generate it from zod with `z.toJSONSchema(schema)`.
 */
export const JsonSchemaObject = z.looseObject({ type: z.literal('object') });
export type JsonSchemaObject = z.infer<typeof JsonSchemaObject>;

/**
 * A tool that Brot exposes to the engine through its MCP server. Every such tool declares its risk.
 * `name` is the bare tool name (`[A-Za-z0-9_-]`, up to 64 characters); the engine sees it prefixed by
 * the MCP server name.
 */
export const BrotToolSpec = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  description: z.string().min(1),
  inputSchema: JsonSchemaObject,
  risk: ToolRisk,
  requiresSecrets: z.array(SecretRef).max(16).optional(),
});
export type BrotToolSpec = z.infer<typeof BrotToolSpec>;

const McpServerName = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

/** An MCP server launched as a child process. */
export const StdioMcpServer = z.object({
  name: McpServerName,
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});
export type StdioMcpServer = z.infer<typeof StdioMcpServer>;

/** An MCP server reached over HTTP, such as the Brot MCP server on loopback. */
export const HttpMcpServer = z.object({
  name: McpServerName,
  url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).default({}),
});
export type HttpMcpServer = z.infer<typeof HttpMcpServer>;

/**
 * An MCP server a driver must attach. Narrow with `'command' in spec` (stdio) or `'url' in spec` (http).
 * `env` and `headers` carry configuration, not secrets: tools that need a secret declare
 * `requiresSecrets` and the broker injects the value when the tool runs.
 */
export const McpServerSpec = z.union([StdioMcpServer, HttpMcpServer]);
export type McpServerSpec = z.infer<typeof McpServerSpec>;

/** A tool's root must be an object, so a target bot is one optional field each, and exactly one is required. */
function exactlyOneBot(value: { botId?: string; botName?: string }, ctx: z.RefinementCtx): void {
  if ((value.botId === undefined) === (value.botName === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'name the target bot with exactly one of botId or botName' });
  }
}

const BotRef = z.string().min(1);

/** Input of `ask_bot`: asks another bot a question and waits for its answer. */
export const AskBotInput = z
  .object({
    botId: BotRef.optional(),
    botName: BotRef.optional(),
    question: z.string().min(1),
  })
  .superRefine(exactlyOneBot);
export type AskBotInput = z.infer<typeof AskBotInput>;

/** Input of `delegate_task`: hands a task to another bot. The bot works it asynchronously and reports a result. */
export const DelegateTaskInput = z
  .object({
    botId: BotRef.optional(),
    botName: BotRef.optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    parentTaskId: z.string().min(1).optional(),
  })
  .superRefine(exactlyOneBot);
export type DelegateTaskInput = z.infer<typeof DelegateTaskInput>;

/** Input of `handoff`: passes the room's baton to another member. */
export const HandoffInput = z
  .object({
    botId: BotRef.optional(),
    botName: BotRef.optional(),
    note: z.string().optional(),
  })
  .superRefine(exactlyOneBot);
export type HandoffInput = z.infer<typeof HandoffInput>;

/**
 * Input of `update_my_task`: the assignee reports progress on its own task. A bot cannot reopen a task
 * (`open`) or cancel it, since those belong to whoever created the work.
 */
export const UpdateMyTaskInput = z.object({
  taskId: z.string().min(1),
  status: z.enum(['in_progress', 'blocked', 'done', 'failed']),
  result: z.string().optional(),
});
export type UpdateMyTaskInput = z.infer<typeof UpdateMyTaskInput>;

/** Input of `list_team`, which takes no arguments. */
export const ListTeamInput = z.object({});
export type ListTeamInput = z.infer<typeof ListTeamInput>;
