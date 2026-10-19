import type { Approval, CanonicalEvent, Message, Run } from '@brot/protocol';

export interface Draft {
  id: string;
  runId?: string;
  content: string;
  at: string;
}

export interface ToolCall {
  callId: string;
  runId?: string;
  tool: string;
  args: Record<string, unknown>;
  at: string;
  result?: { ok: boolean; output: string };
}

export interface RunInfo {
  id: string;
  status: Run['status'];
  startedAt: string;
  error?: string;
  endedAt?: string;
}

export interface ThreadState {
  threadId: string;
  messages: Message[];
  drafts: Record<string, Draft>;
  tools: Record<string, ToolCall>;
  runs: Record<string, RunInfo>;
  approvals: Record<string, Approval>;
  /** Ids of events already applied, so a replayed event is a no-op. */
  applied: Record<string, true>;
}

export type TimelineItem =
  | { kind: 'message'; key: string; at: string; message: Message }
  | { kind: 'draft'; key: string; at: string; draft: Draft }
  | { kind: 'tool'; key: string; at: string; call: ToolCall }
  | { kind: 'approval'; key: string; at: string; approval: Approval }
  | { kind: 'error'; key: string; at: string; run: RunInfo };

const ts = (iso: string) => Date.parse(iso);

function upsertMessage(messages: Message[], message: Message): Message[] {
  const next = messages.filter((existing) => existing.id !== message.id);
  next.push(message);
  return next.sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
}

export function initThread(
  threadId: string,
  records: { messages?: Message[]; runs?: Run[]; approvals?: Approval[] } = {},
): ThreadState {
  const runs: Record<string, RunInfo> = {};
  for (const run of records.runs ?? []) {
    runs[run.id] = { id: run.id, status: run.status, startedAt: run.startedAt, error: run.error, endedAt: run.endedAt };
  }
  const approvals: Record<string, Approval> = {};
  for (const approval of records.approvals ?? []) {
    if (approval.threadId === threadId) approvals[approval.id] = approval;
  }
  return {
    threadId,
    messages: [...(records.messages ?? [])].sort((a, b) => ts(a.createdAt) - ts(b.createdAt)),
    drafts: {},
    tools: {},
    runs,
    approvals,
    applied: {},
  };
}

function setRun(state: ThreadState, runId: string | undefined, patch: Partial<RunInfo>, at: string): Record<string, RunInfo> {
  if (!runId) return state.runs;
  const current = state.runs[runId] ?? { id: runId, status: 'running' as const, startedAt: at };
  return { ...state.runs, [runId]: { ...current, ...patch } };
}

function dropRunDrafts(drafts: Record<string, Draft>, messageId: string, runId: string | undefined): Record<string, Draft> {
  const next: Record<string, Draft> = {};
  for (const [id, draft] of Object.entries(drafts)) {
    if (id === messageId) continue;
    if (runId !== undefined && draft.runId === runId) continue;
    next[id] = draft;
  }
  return next;
}

/** Folds one live event into a thread. Events for other threads and repeats are ignored. */
export function applyThreadEvent(state: ThreadState, event: CanonicalEvent): ThreadState {
  if (event.threadId !== state.threadId || state.applied[event.id]) return state;
  const base = { ...state, applied: { ...state.applied, [event.id]: true as const } };

  switch (event.type) {
    case 'run.started':
      return { ...base, runs: setRun(state, event.runId, { status: 'running', startedAt: event.at }, event.at) };
    case 'message.delta': {
      const current = state.drafts[event.messageId];
      const draft: Draft = current
        ? { ...current, content: current.content + event.delta }
        : { id: event.messageId, runId: event.runId, content: event.delta, at: event.at };
      return { ...base, drafts: { ...state.drafts, [event.messageId]: draft } };
    }
    case 'message.completed':
      return {
        ...base,
        messages: upsertMessage(state.messages, event.message),
        drafts: dropRunDrafts(state.drafts, event.message.id, event.message.role === 'assistant' ? event.runId : undefined),
      };
    case 'tool.call':
      return {
        ...base,
        tools: {
          ...state.tools,
          [event.callId]: { callId: event.callId, runId: event.runId, tool: event.tool, args: event.args, at: event.at },
        },
      };
    case 'tool.result': {
      const call = state.tools[event.callId];
      if (!call) return base;
      return { ...base, tools: { ...state.tools, [event.callId]: { ...call, result: { ok: event.ok, output: event.output } } } };
    }
    case 'approval.requested':
      return {
        ...base,
        approvals: { ...state.approvals, [event.approval.id]: event.approval },
        runs: setRun(state, event.runId ?? event.approval.runId, { status: 'waiting_approval' }, event.at),
      };
    case 'approval.resolved': {
      const runId = event.runId ?? event.approval.runId;
      const run = state.runs[runId];
      const stillWaiting = Object.values(state.approvals).some(
        (other) => other.id !== event.approval.id && other.runId === runId && other.status === 'pending',
      );
      return {
        ...base,
        approvals: { ...state.approvals, [event.approval.id]: event.approval },
        runs: run && run.status === 'waiting_approval' && !stillWaiting ? setRun(state, runId, { status: 'running' }, event.at) : state.runs,
      };
    }
    case 'run.completed':
      return { ...base, runs: setRun(state, event.runId, { status: 'completed', endedAt: event.at }, event.at) };
    case 'run.failed':
      return {
        ...base,
        runs: setRun(state, event.runId, { status: 'failed', error: event.error, endedAt: event.at }, event.at),
        drafts: event.runId ? dropRunDrafts(state.drafts, '', event.runId) : state.drafts,
      };
    case 'memory.written':
    case 'cost.updated':
      return base;
  }
}

/** The run currently in progress, if any. */
export function activeRun(state: ThreadState): RunInfo | undefined {
  return Object.values(state.runs)
    .filter((run) => run.status === 'running' || run.status === 'waiting_approval')
    .sort((a, b) => ts(b.startedAt) - ts(a.startedAt))[0];
}

/** True while a run is working and nothing is streaming yet: the moment for the typing indicator. */
export function showTyping(state: ThreadState): boolean {
  const run = activeRun(state);
  if (!run || run.status !== 'running') return false;
  return !Object.values(state.drafts).some((draft) => draft.runId === run.id && draft.content.length > 0);
}

export function pendingApprovals(state: ThreadState): Approval[] {
  return Object.values(state.approvals)
    .filter((approval) => approval.status === 'pending')
    .sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
}

/** Everything the thread shows, oldest first. Failed runs appear as an inline error line. */
export function timeline(state: ThreadState): TimelineItem[] {
  const items: TimelineItem[] = [
    ...state.messages.map((message): TimelineItem => ({ kind: 'message', key: `m:${message.id}`, at: message.createdAt, message })),
    ...Object.values(state.drafts).map((draft): TimelineItem => ({ kind: 'draft', key: `d:${draft.id}`, at: draft.at, draft })),
    ...Object.values(state.tools).map((call): TimelineItem => ({ kind: 'tool', key: `t:${call.callId}`, at: call.at, call })),
    ...Object.values(state.approvals).map(
      (approval): TimelineItem => ({ kind: 'approval', key: `a:${approval.id}`, at: approval.createdAt, approval }),
    ),
    ...Object.values(state.runs)
      .filter((run) => run.status === 'failed' && run.error)
      .map((run): TimelineItem => ({ kind: 'error', key: `e:${run.id}`, at: run.endedAt ?? run.startedAt, run })),
  ];
  return items.sort((a, b) => ts(a.at) - ts(b.at));
}

/** The thread a bot row opens: the most recently active one. */
export function latestThread<T extends { updatedAt: string }>(threads: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const thread of threads) {
    if (!best || ts(thread.updatedAt) > ts(best.updatedAt)) best = thread;
  }
  return best;
}
