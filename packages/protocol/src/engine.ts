import type { ApprovalKind, Bot, Memory, Message, Skill } from './entities';

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
  | { type: 'memory'; kind: Memory['kind']; content: string };

export interface RunContext {
  runId: string;
  threadId: string;
  bot: Bot;
  history: Message[];
  input: string;
  memories: Memory[];
  skills: Skill[];
  signal: AbortSignal;
  /** Every risky action must be requested here; the permission broker decides (may block awaiting a human). */
  requestTool(req: ToolRequest): Promise<ToolDecision>;
}

export interface EngineDriver {
  id: string;
  label: string;
  detect(): Promise<EngineAvailability>;
  models(): Promise<ModelInfo[]>;
  run(ctx: RunContext): AsyncIterable<EngineEvent>;
}
