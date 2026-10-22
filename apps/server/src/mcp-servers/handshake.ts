import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpServerTestResult, type McpServer } from '@brot/protocol';
import { redact } from '../mcp/helpers';
import type { Vault } from '../vault';
import { resolveCommand, resolveEnv } from './specs';

/** How long a test handshake may take before the server is reported unreachable. */
export const MCP_TEST_TIMEOUT_MS = 10_000;
/** Listing every tool of a huge server would flood the response; the first ones prove the handshake. */
const TOOL_CAP = 50;
const CLIENT_INFO = { name: 'brot-mcp-test', version: '0.1.0' };

export interface McpHandshakeOptions {
  vault: Pick<Vault, 'resolveRef'>;
  /** Tests shorten it. Defaults to `MCP_TEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Connects to a user MCP server the way a run's engine would, lists its tool names and disconnects. It never
 * throws: a failed handshake is a result, not a server error. Resolved secret env values are scrubbed from the
 * error text, so a failure can never echo one.
 */
export async function testMcpServer(server: McpServer, options: McpHandshakeOptions): Promise<McpServerTestResult> {
  const startedAt = Date.now();
  const secretValues: string[] = [];
  let client: Client | undefined;
  try {
    const transport = await transportFor(server, options, secretValues);
    client = new Client(CLIENT_INFO);
    const tools = await withTimeout(connectAndList(client, transport), options.timeoutMs ?? MCP_TEST_TIMEOUT_MS);
    return McpServerTestResult.parse({
      ok: true,
      tools: tools.slice(0, TOOL_CAP),
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    return { ok: false, error: redact(messageOf(error), secretValues) };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

async function transportFor(
  server: McpServer,
  options: McpHandshakeOptions,
  secretValues: string[],
): Promise<Transport> {
  if (server.transport === 'stdio') {
    const env = await resolveEnv(server.env, options.vault);
    // Plain configuration values are scrubbed too: an error must never repeat any of the child's env.
    secretValues.push(...Object.values(server.env), ...Object.values(env));
    const lookup = await resolveCommand(server.command ?? '');
    if (!lookup.ok) throw new Error(lookup.error);
    const transport = new StdioClientTransport({
      command: lookup.command,
      args: server.args,
      env: { ...getDefaultEnvironment(), ...env },
      stderr: 'pipe',
    });
    // The child's stderr may carry configuration; drain it instead of forwarding it to the server's log.
    transport.stderr?.on('data', () => undefined);
    return transport;
  }
  if (server.url === undefined) throw new Error('the http MCP server has no url');
  secretValues.push(...Object.values(server.env));
  return new StreamableHTTPClientTransport(new URL(server.url));
}

async function connectAndList(client: Client, transport: Transport): Promise<string[]> {
  await client.connect(transport);
  const listed = await client.listTools();
  return listed.tools.map((tool) => tool.name);
}

function withTimeout<T>(run: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    const amount = timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} seconds` : `${timeoutMs} milliseconds`;
    timer = setTimeout(() => reject(new Error(`the MCP server did not answer within ${amount}`)), timeoutMs);
  });
  return Promise.race([run, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
