import type { Repos } from '@brot/db';
import type { ApprovalKind, BrotToolSpec, McpServerSpec, SecretRef, ToolDecision, ToolRisk } from '@brot/protocol';
import type { Hono } from 'hono';
import type { ApprovalScope, Broker } from '../broker';
import type { EventBus } from '../bus';
import type { Vault } from '../vault';
import type { HttpOptions } from './http-request';

/** What a Brot tool returns. `output` goes to the model, so it never contains a secret value. */
export interface ToolResult {
  ok: boolean;
  output: string;
}

/** A call that passed argument validation and is ready for the broker. Nothing has run yet. */
export interface PreparedCall {
  risk: ToolRisk;
  kind: ApprovalKind;
  /** One line for the approval prompt. Arguments carry `secret://` references, never values. */
  summary: string;
  /** Secrets the call uses beyond the tool's static `requiresSecrets`. Resolved only after the broker allows the call. */
  secrets?: SecretRef[];
  /** Executes the call. Runs only after the broker allowed it. `secrets` maps each reference to its value. */
  run(secrets: Record<string, string>): Promise<ToolResult>;
}

export interface BrotTool {
  spec: BrotToolSpec;
  /**
   * Validates the raw arguments and describes the call, before any approval is requested. An error here
   * is returned to the engine and the user is never asked about an invalid call.
   */
  prepare(scope: ApprovalScope, args: Record<string, unknown>): Promise<PreparedCall | { error: string }>;
}

export interface BrotMcpDeps {
  broker: Broker;
  vault: Vault;
  repos: Repos;
  bus: EventBus;
  /** Tools added to the built-in ones. Names must be unique. */
  tools?: BrotTool[];
  /** Overrides for outbound HTTP: the resolver and sender are injectable for tests. */
  http?: HttpOptions;
}

/** A tool call that the broker decided, kept for tests and diagnostics. */
export interface RecordedDecision {
  runId: string;
  tool: string;
  decision: ToolDecision;
}

export interface BrotMcp {
  /**
   * The MCP server a run's engine must attach. Authenticated with a token bound to that run, so a
   * call can only act as that run's bot. `baseUrl` is the server as seen from where the engine runs.
   * Calling it again for the same run replaces the run's token.
   */
  specForRun(scope: ApprovalScope, baseUrl: string): McpServerSpec;
  /** Invalidates the run's token. Called when the run ends. */
  endRun(runId: string): void;
  /** The most recent broker decisions, oldest first. */
  readonly lastDecisions: ReadonlyArray<RecordedDecision>;
}

/** What `createBrotMcp` returns: the MCP API plus the Hono sub-app that serves `/mcp/runs/:runId`. */
export type BrotMcpService = BrotMcp & { route: Hono };
