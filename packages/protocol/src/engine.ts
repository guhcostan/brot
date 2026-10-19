import type { ApprovalKind, Bot, Memory, Message, Skill } from './entities';
import type { McpServerSpec, ToolRisk } from './tools';

export interface EngineAvailability {
  available: boolean;
  reason?: string;
  version?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ToolRequest {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  kind: ApprovalKind;
  summary: string;
  /** Declared risk of a Brot MCP tool (its `BrotToolSpec`). Absent for the engine's own tools. */
  risk?: ToolRisk;
}

export interface ToolDecision {
  allowed: boolean;
  reply?: string;
}

export type EngineEvent =
  | { type: 'text.delta'; delta: string }
  | { type: 'tool.call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool.result'; callId: string; ok: boolean; output: string }
  | { type: 'usage'; tokensIn: number; tokensOut: number; costUsd: number }
  | { type: 'memory'; kind: Memory['kind']; content: string }
  /** The engine's session for this thread. The server persists it and passes it back as `engineSessionId`. */
  | { type: 'engine.session'; sessionId: string };

export interface ComputerExecOptions {
  env?: Record<string, string>;
  cwd?: string;
}

/** How a process inside a computer ended. `code` is null when a signal ended it. */
export interface ComputerExit {
  code: number | null;
  signal: string | null;
}

/**
 * A process started inside a computer. Stdio uses Web Streams: the ACP SDK consumes them directly,
 * they exist in Node, Bun and browsers, and the protocol package stays free of Node types. Adapters
 * convert Node streams once at the edge (`Readable.toWeb`, `Writable.toWeb`).
 */
export interface ComputerProcess {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  /** Resolves once when the process exits. It does not reject. */
  exit: Promise<ComputerExit>;
  kill(signal?: 'SIGTERM' | 'SIGKILL'): void;
}

/**
 * A bot's computer as drivers see it. A docker-exec adapter and a local spawn both implement it.
 * `exec` is async because a container exec must be created and started before its streams exist.
 */
export interface ComputerHandle {
  readonly id: string;
  exec(cmd: string[], opts?: ComputerExecOptions): Promise<ComputerProcess>;
}

export interface RunContext {
  runId: string;
  threadId: string;
  bot: Bot;
  history: Message[];
  input: string;
  memories: Memory[];
  skills: Skill[];
  signal: AbortSignal;
  /** The engine session to resume for this thread, from the last `engine.session` event. Absent for a new thread. */
  engineSessionId?: string;
  /**
   * The computer that the engine's tools run in. Present for `computer: 'sandbox'` and `'host'`.
   * Absent for `'none'`, which gives the engine no shell or filesystem tools.
   */
  computer?: ComputerHandle;
  /** MCP servers the engine must attach, typically the Brot MCP server that exposes `BrotToolSpec` tools. */
  mcpServers?: McpServerSpec[];
  /** Every risky action must be requested here; the permission broker decides (may block awaiting a human). */
  requestTool(req: ToolRequest): Promise<ToolDecision>;
}

export interface EngineDriver {
  id: string;
  label: string;
  detect(): Promise<EngineAvailability>;
  models(): Promise<ModelInfo[]>;
  run(ctx: RunContext): AsyncIterable<EngineEvent>;
  /**
   * Stops the processes the driver started. The server calls it on shutdown and on idle eviction.
   * Stateless drivers omit it.
   */
  close?(): Promise<void>;
}
