import type { Approval, CanonicalEvent, Memory } from '@brot/protocol';

/**
 * The thread view is a pure fold over canonical events (docs/ARCHITECTURE.md). Replaying the same
 * events always yields the same view, so live streams and stored history share one code path.
 */

export type RunState = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed';

export type MessageItem = {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming: boolean;
  at: string;
};

export type ToolItem = {
  kind: 'tool';
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'ok' | 'error';
  output?: string;
};

export type ApprovalItem = { kind: 'approval'; approval: Approval };

export type TimelineItem = MessageItem | ToolItem | ApprovalItem;

export interface RunCost {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface ThreadState {
  items: TimelineItem[];
  run: RunState;
  costByRun: Record<string, RunCost>;
  memories: Memory[];
}

export const emptyThread: ThreadState = { items: [], run: 'idle', costByRun: {}, memories: [] };

function settleStreaming(items: TimelineItem[]): TimelineItem[] {
  return items.map((item) => (item.kind === 'message' && item.streaming ? { ...item, streaming: false } : item));
}

function replaceWhere<T extends TimelineItem>(
  items: TimelineItem[],
  match: (item: TimelineItem) => item is T,
  next: (prev: T) => TimelineItem,
): TimelineItem[] {
  return items.map((item) => (match(item) ? next(item) : item));
}

export function applyEvent(state: ThreadState, event: CanonicalEvent): ThreadState {
  switch (event.type) {
    case 'run.started':
      return { ...state, run: 'running' };

    case 'message.delta': {
      const exists = state.items.some((item) => item.kind === 'message' && item.id === event.messageId);
      if (!exists) {
        const item: MessageItem = {
          kind: 'message',
          id: event.messageId,
          role: 'assistant',
          content: event.delta,
          streaming: true,
          at: event.at,
        };
        return { ...state, items: [...state.items, item] };
      }
      return {
        ...state,
        items: replaceWhere(
          state.items,
          (item): item is MessageItem => item.kind === 'message' && item.id === event.messageId,
          (prev) => ({ ...prev, content: prev.content + event.delta }),
        ),
      };
    }

    case 'message.completed': {
      const { message } = event;
      const next: MessageItem = {
        kind: 'message',
        id: message.id,
        role: message.role,
        content: message.content,
        streaming: false,
        at: message.createdAt,
      };
      const exists = state.items.some((item) => item.kind === 'message' && item.id === message.id);
      return {
        ...state,
        items: exists
          ? replaceWhere(
              state.items,
              (item): item is MessageItem => item.kind === 'message' && item.id === message.id,
              () => next,
            )
          : [...state.items, next],
      };
    }

    case 'tool.call': {
      if (state.items.some((item) => item.kind === 'tool' && item.callId === event.callId)) return state;
      const item: ToolItem = { kind: 'tool', callId: event.callId, tool: event.tool, args: event.args, status: 'running' };
      return { ...state, items: [...state.items, item] };
    }

    case 'tool.result':
      return {
        ...state,
        items: replaceWhere(
          state.items,
          (item): item is ToolItem => item.kind === 'tool' && item.callId === event.callId,
          (prev) => ({ ...prev, status: event.ok ? 'ok' : 'error', output: event.output }),
        ),
      };

    case 'approval.requested': {
      if (state.items.some((item) => item.kind === 'approval' && item.approval.id === event.approval.id)) {
        return { ...state, run: 'waiting_approval' };
      }
      const item: ApprovalItem = { kind: 'approval', approval: event.approval };
      return { ...state, run: 'waiting_approval', items: [...state.items, item] };
    }

    case 'approval.resolved':
      return {
        ...state,
        run: 'running',
        items: replaceWhere(
          state.items,
          (item): item is ApprovalItem => item.kind === 'approval' && item.approval.id === event.approval.id,
          () => ({ kind: 'approval', approval: event.approval }),
        ),
      };

    case 'memory.written': {
      const others = state.memories.filter((memory) => memory.id !== event.memory.id);
      return { ...state, memories: [...others, event.memory] };
    }

    case 'cost.updated':
      return {
        ...state,
        costByRun: {
          ...state.costByRun,
          [event.runId ?? 'default']: {
            tokensIn: event.tokensIn,
            tokensOut: event.tokensOut,
            costUsd: event.costUsd,
          },
        },
      };

    case 'run.completed':
      return { ...state, run: 'completed', items: settleStreaming(state.items) };

    case 'run.failed': {
      const notice: MessageItem = {
        kind: 'message',
        id: `${event.id}:error`,
        role: 'system',
        content: event.error,
        streaming: false,
        at: event.at,
      };
      return { ...state, run: 'failed', items: [...settleStreaming(state.items), notice] };
    }
  }
}

export function foldEvents(events: readonly CanonicalEvent[], start: ThreadState = emptyThread): ThreadState {
  return events.reduce(applyEvent, start);
}

export type BotStatus = 'idle' | 'working' | 'waiting' | 'error';

export function pendingApprovals(state: ThreadState): ApprovalItem[] {
  return state.items.filter(
    (item): item is ApprovalItem => item.kind === 'approval' && item.approval.status === 'pending',
  );
}

/** Maps a thread to the sidebar status. Waiting for a human outranks everything else. */
export function botStatus(state: ThreadState): BotStatus {
  if (pendingApprovals(state).length > 0 || state.run === 'waiting_approval') return 'waiting';
  if (state.run === 'running') return 'working';
  if (state.run === 'failed') return 'error';
  return 'idle';
}

export function sumCost(state: ThreadState): RunCost {
  return Object.values(state.costByRun).reduce(
    (total, run) => ({
      tokensIn: total.tokensIn + run.tokensIn,
      tokensOut: total.tokensOut + run.tokensOut,
      costUsd: total.costUsd + run.costUsd,
    }),
    { tokensIn: 0, tokensOut: 0, costUsd: 0 },
  );
}
