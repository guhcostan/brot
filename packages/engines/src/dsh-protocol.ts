import type { ApprovalKind, EngineEvent } from '@brot/protocol';
import type {
  PermissionOption,
  SessionConfigOption,
  SessionUpdate,
  ToolCallContent,
  ToolKind,
  Usage,
} from '@agentclientprotocol/sdk';

/** ACP configuration option that selects the provider and model of a session. */
export const MODEL_CONFIG_ID = 'model';

export interface ModelEntry {
  /** Brot-facing identifier, `provider/model`. */
  id: string;
  label: string;
  /** Opaque option value that `session/set_config_option` accepts. */
  value: string;
}

export interface ToolInfo {
  tool: string;
  args: Record<string, unknown>;
  kind?: ToolKind | null;
}

/** Tool calls seen in one run, so each call emits its start and its single result once. */
export interface ToolState {
  calls: Map<string, ToolInfo>;
  finished: Set<string>;
}

export function createToolState(): ToolState {
  return { calls: new Map(), finished: new Set() };
}

export function startTool(state: ToolState, callId: string, info: ToolInfo): EngineEvent[] {
  if (state.calls.has(callId)) return [];
  state.calls.set(callId, info);
  return [{ type: 'tool.call', callId, tool: info.tool, args: info.args }];
}

export function finishTool(
  state: ToolState,
  callId: string,
  fallback: ToolInfo,
  ok: boolean,
  output: string,
): EngineEvent[] {
  if (state.finished.has(callId)) return [];
  state.finished.add(callId);
  const events = startTool(state, callId, state.calls.get(callId) ?? fallback);
  events.push({ type: 'tool.result', callId, ok, output });
  return events;
}

/**
 * Maps one `session/update` payload to canonical events. Text chunks become deltas;
 * a call's start and its completed or failed status become tool.call and tool.result.
 * Thoughts, plans, and context-usage gauges have no canonical event and are dropped.
 */
export function updateEvents(update: SessionUpdate, state: ToolState): EngineEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text' && update.content.text
        ? [{ type: 'text.delta', delta: update.content.text }]
        : [];
    case 'tool_call':
      return startTool(state, update.toolCallId, {
        tool: update.title,
        args: toolArgs(update.rawInput),
        kind: update.kind,
      });
    case 'tool_call_update': {
      if (update.status !== 'completed' && update.status !== 'failed') return [];
      const fallback: ToolInfo = {
        tool: update.title ?? 'tool',
        args: toolArgs(update.rawInput),
        kind: update.kind,
      };
      const ok = update.status === 'completed';
      return finishTool(state, update.toolCallId, fallback, ok, outputText(update.content) || (ok ? 'ok' : 'failed'));
    }
    default:
      return [];
  }
}

/**
 * Per-turn token usage from the prompt response. ACP reports no cost, so costUsd is 0.
 */
export function usageEvents(usage: Usage | null | undefined): EngineEvent[] {
  if (usage === undefined || usage === null) return [];
  return [{ type: 'usage', tokensIn: usage.inputTokens, tokensOut: usage.outputTokens, costUsd: 0 }];
}

/**
 * Only `execute`, `edit`/`move`, and `delete` have a Brot approval kind. DeepSeek Harness
 * reports every call as `other`, so its approvals stay `other` and are keyed by tool name.
 */
export function approvalKindFor(kind: ToolKind | null | undefined): ApprovalKind {
  switch (kind) {
    case 'execute':
      return 'shell';
    case 'edit':
    case 'move':
      return 'file_write';
    case 'delete':
      return 'delete';
    default:
      return 'other';
  }
}

export function toolArgs(rawInput: unknown): Record<string, unknown> {
  if (rawInput === undefined || rawInput === null) return {};
  if (typeof rawInput === 'object' && !Array.isArray(rawInput)) return rawInput as Record<string, unknown>;
  return { input: rawInput };
}

export function outputText(content: readonly ToolCallContent[] | null | undefined): string {
  const texts: string[] = [];
  for (const item of content ?? []) {
    if (item.type === 'content' && item.content.type === 'text' && item.content.text) {
      texts.push(item.content.text);
    }
  }
  return texts.join('\n');
}

/** Only `allow_once` is answered with allow. A persistent `allow_always` is never chosen on Brot's behalf. */
export function allowOptionId(options: readonly PermissionOption[]): string | undefined {
  return options.find((option) => option.kind === 'allow_once')?.optionId;
}

/** Only `reject_once` is answered with a rejection; a persistent `reject_always` is never chosen on Brot's behalf. */
export function rejectOptionId(options: readonly PermissionOption[]): string | undefined {
  return options.find((option) => option.kind === 'reject_once')?.optionId;
}

export function modelEntries(options: readonly SessionConfigOption[]): ModelEntry[] {
  const select = modelOption(options);
  if (select === undefined) return [];
  const entries: ModelEntry[] = [];
  for (const item of select.options) {
    if ('group' in item) {
      for (const option of item.options) entries.push(modelEntry(option.value, option.name, item.name));
    } else {
      entries.push(modelEntry(item.value, item.name));
    }
  }
  return entries;
}

export function currentModelValue(options: readonly SessionConfigOption[]): string | undefined {
  return modelOption(options)?.currentValue;
}

export function modelValueFor(entries: readonly ModelEntry[], id: string): string | undefined {
  return entries.find((entry) => entry.id === id)?.value;
}

function modelOption(options: readonly SessionConfigOption[]) {
  const option = options.find((item) => item.id === MODEL_CONFIG_ID);
  return option?.type === 'select' ? option : undefined;
}

function modelEntry(value: string, name: string, group?: string): ModelEntry {
  return {
    id: brotModelId(value),
    label: group === undefined ? name : `${group}: ${name}`,
    value,
  };
}

/** `["provider","model"]` becomes `provider/model`; any other value is used as its own id. */
function brotModelId(value: string): string {
  const parsed = parseJson(value);
  if (
    Array.isArray(parsed) &&
    parsed.length === 2 &&
    typeof parsed[0] === 'string' &&
    typeof parsed[1] === 'string'
  ) {
    return `${parsed[0]}/${parsed[1]}`;
  }
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}
