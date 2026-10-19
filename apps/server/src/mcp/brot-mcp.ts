import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { HttpMcpServer, type BrotToolSpec, type SecretRef, type ToolDecision } from '@brot/protocol';
import { Hono } from 'hono';
import type { ApprovalScope } from '../broker';
import { createHttpRequestTool } from './http-request';
import { createNotifyUserTool, createRememberTool } from './builtin-tools';
import { redact } from './helpers';
import type { BrotMcpDeps, BrotMcpService, BrotTool, RecordedDecision } from './types';

const MCP_SERVER_NAME = 'brot';
const MCP_SERVER_VERSION = '0.1.0';
const MAX_RECORDED_DECISIONS = 200;

interface RunEntry {
  /** SHA-256 of the run token. The token itself is never stored. */
  tokenDigest: Buffer;
  scope: ApprovalScope;
}

/**
 * The Brot MCP server. Each run gets its own bearer token, and `/mcp/runs/:runId` accepts only that token.
 * Every tool call is prepared, decided by the broker, and only then run; secrets are resolved after the
 * broker allows the call and redacted from anything returned.
 *
 * Mount `route` on the app. It is deliberately outside the device-auth middleware, which covers `/api/*`
 * only, and it never trusts loopback: the caller is the run's container, so only the run token counts.
 */
export function createBrotMcp(deps: BrotMcpDeps): BrotMcpService {
  const tools = registerTools(deps);
  const specs = [...tools.values()].map((tool) => tool.spec);
  const runs = new Map<string, RunEntry>();
  const decisions: RecordedDecision[] = [];

  function recordDecision(entry: RecordedDecision): void {
    decisions.push(entry);
    if (decisions.length > MAX_RECORDED_DECISIONS) decisions.splice(0, decisions.length - MAX_RECORDED_DECISIONS);
  }

  async function callTool(scope: ApprovalScope, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const tool = tools.get(name);
    if (!tool) return toolError(`Unknown tool ${name}.`);

    let prepared: Awaited<ReturnType<BrotTool['prepare']>>;
    try {
      prepared = await tool.prepare(scope, args);
    } catch (error) {
      console.error(`brot mcp tool ${name} could not be prepared`, error);
      return toolError(`Brot could not prepare ${name}.`);
    }
    if ('error' in prepared) return toolError(prepared.error);

    let decision: ToolDecision;
    try {
      decision = await deps.broker.request(scope, {
        callId: randomUUID(),
        tool: name,
        args,
        kind: prepared.kind,
        summary: prepared.summary,
        risk: prepared.risk,
      });
    } catch (error) {
      console.error(`brot mcp approval for ${name} failed`, error);
      return toolError('Brot could not record the approval request.');
    }
    recordDecision({ runId: scope.runId, tool: name, decision });
    if (!decision.allowed) return toolError(decision.reply ?? 'Denied.');

    const refs = uniqueRefs([...(tool.spec.requiresSecrets ?? []), ...(prepared.secrets ?? [])]);
    const secrets: Record<string, string> = {};
    for (const ref of refs) {
      let value: string | undefined;
      try {
        value = await deps.vault.resolveRef(ref);
      } catch (error) {
        console.error(`brot mcp could not read ${ref}`, error);
        return toolError(`Brot could not read ${ref}.`);
      }
      if (value === undefined) return toolError(`Secret ${ref} is not set.`);
      secrets[ref] = value;
    }

    const values = Object.values(secrets);
    let result: { ok: boolean; output: string };
    try {
      result = await prepared.run(secrets);
    } catch (error) {
      result = { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
    return {
      isError: !result.ok,
      content: [{ type: 'text', text: redact(result.output, values) }],
    };
  }

  function buildServer(scope: ApprovalScope): Server {
    const server = new Server({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: specs.map(toMcpTool) }));
    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      callTool(scope, request.params.name, request.params.arguments ?? {}),
    );
    return server;
  }

  const route = new Hono();
  route.all('/mcp/runs/:runId', async (c) => {
    const entry = runs.get(c.req.param('runId'));
    if (!entry || !bearerMatches(c.req.header('authorization'), entry.tokenDigest)) {
      return c.json({ error: 'Authentication required' }, 401, { 'WWW-Authenticate': 'Bearer' });
    }
    const server = buildServer(entry.scope);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } catch (error) {
      console.error('brot mcp request failed', error);
      return c.json({ error: 'MCP request failed' }, 500);
    } finally {
      await server.close();
    }
  });

  return {
    route,

    specForRun(scope, baseUrl) {
      const token = randomBytes(32).toString('base64url');
      runs.set(scope.runId, { tokenDigest: sha256(token), scope });
      return HttpMcpServer.parse({
        name: MCP_SERVER_NAME,
        url: `${baseUrl.replace(/\/+$/, '')}/mcp/runs/${encodeURIComponent(scope.runId)}`,
        headers: { Authorization: `Bearer ${token}` },
      });
    },

    endRun(runId) {
      runs.delete(runId);
    },

    get lastDecisions(): ReadonlyArray<RecordedDecision> {
      return decisions;
    },
  };
}

function registerTools(deps: BrotMcpDeps): Map<string, BrotTool> {
  const builtin = [
    createHttpRequestTool({ repos: deps.repos, bus: deps.bus, ...deps.http }),
    createNotifyUserTool({ repos: deps.repos, bus: deps.bus }),
    createRememberTool({ repos: deps.repos, bus: deps.bus }),
  ];
  const tools = new Map<string, BrotTool>();
  for (const tool of [...builtin, ...(deps.tools ?? [])]) {
    if (tools.has(tool.spec.name)) throw new Error(`Brot MCP tool "${tool.spec.name}" is registered twice`);
    tools.set(tool.spec.name, tool);
  }
  return tools;
}

function toMcpTool(spec: BrotToolSpec): Tool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: { readOnlyHint: spec.risk === 'read', destructiveHint: spec.risk === 'irreversible' },
  };
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

function uniqueRefs(refs: SecretRef[]): SecretRef[] {
  return [...new Set(refs)];
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time comparison of the presented bearer token with the run's stored digest. */
function bearerMatches(header: string | undefined, expected: Buffer): boolean {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!match?.[1]) return false;
  return timingSafeEqual(sha256(match[1]), expected);
}
