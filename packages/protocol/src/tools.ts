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
