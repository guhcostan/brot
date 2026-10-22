import { z } from 'zod';
import { IsoDateTime } from './entities';
import { SecretRef } from './tools';

/** How Brot reaches a user MCP server: a child process it spawns, or an HTTP endpoint. */
export const McpServerTransport = z.enum(['stdio', 'http']);
export type McpServerTransport = z.infer<typeof McpServerTransport>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * A user MCP server must use https, or http on loopback (a local server). Credentials, query strings and
 * fragments are refused, so a token never lands in the stored URL. Same rule as a model provider's base URL.
 */
export const McpServerUrl = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
    return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
  }, 'url must be https (or loopback http) with no credentials, query or fragment');
export type McpServerUrl = z.infer<typeof McpServerUrl>;

/** `brot` is reserved for Brot's own MCP server, so a user server can never shadow its tools. */
export const McpServerName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Use letters, digits, dash or underscore (up to 64)')
  .refine((name) => name !== 'brot', '"brot" is reserved for Brot\'s own MCP server');
export type McpServerName = z.infer<typeof McpServerName>;

/**
 * One environment variable of a stdio server. A `secret://<name>` value is resolved from the vault when the
 * process is spawned; any other value is plain configuration.
 */
const McpServerEnvValue = z
  .string()
  .max(65_536)
  .refine(
    (value) => !value.startsWith('secret://') || SecretRef.safeParse(value).success,
    'a secret:// value must name a vault secret',
  );

const McpServerEnv = z.record(z.string(), McpServerEnvValue);

/**
 * The transport-specific fields are only required, never forbidden: changing a server's transport leaves the
 * other field behind, and the unused one is ignored.
 */
function requireTransportFields(
  value: { transport: McpServerTransport; command?: string | undefined; url?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.transport === 'stdio') {
    if (value.command === undefined) {
      ctx.addIssue({ code: 'custom', path: ['command'], message: 'a stdio MCP server needs a command' });
    }
  } else if (value.url === undefined) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'an http MCP server needs a url' });
  }
}

/**
 * A user MCP server. Brot attaches every enabled one to a run's engine, next to the Brot MCP server, so the
 * bot's model gains its tools. `env` holds configuration and `secret://` references only: a secret's value is
 * resolved from the vault into the child process at spawn time and never stored, returned or shown to the model.
 */
export const McpServer = z
  .object({
    id: z.string(),
    name: McpServerName,
    transport: McpServerTransport,
    command: z.string().min(1).max(4096).optional(),
    args: z.array(z.string().max(4096)).max(128),
    env: McpServerEnv,
    url: McpServerUrl.optional(),
    enabled: z.boolean(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .superRefine(requireTransportFields);
export type McpServer = z.infer<typeof McpServer>;

/** Creates a user MCP server. A stdio server needs `command`; an http server needs `url`. */
export const CreateMcpServer = z
  .object({
    name: McpServerName,
    transport: McpServerTransport.default('stdio'),
    command: z.string().min(1).max(4096).optional(),
    args: z.array(z.string().max(4096)).max(128).default(() => []),
    env: McpServerEnv.default(() => ({})),
    url: McpServerUrl.optional(),
    enabled: z.boolean().default(true),
  })
  .superRefine(requireTransportFields);
export type CreateMcpServer = z.infer<typeof CreateMcpServer>;
export type CreateMcpServerInput = z.input<typeof CreateMcpServer>;

/**
 * Updates a user MCP server. The result of merging this patch is validated against the transport, so switching
 * to `http` without a `url` (or to `stdio` without a `command`) is refused by the server.
 */
export const UpdateMcpServer = z.object({
  name: McpServerName.optional(),
  transport: McpServerTransport.optional(),
  command: z.string().min(1).max(4096).optional(),
  args: z.array(z.string().max(4096)).max(128).optional(),
  env: McpServerEnv.optional(),
  url: McpServerUrl.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateMcpServer = z.infer<typeof UpdateMcpServer>;

/** What `POST /api/mcp/servers/:id/test` answers: a successful handshake with its tool names, or why it failed. */
export const McpServerTestResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    tools: z.array(z.string()).max(50),
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type McpServerTestResult = z.infer<typeof McpServerTestResult>;

/** The vault secret an environment value references, or undefined when it is plain configuration. */
export function secretNameOf(value: string): string | undefined {
  const match = /^secret:\/\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/.exec(value);
  return match?.[1];
}
