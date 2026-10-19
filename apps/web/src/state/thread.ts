import type { Approval, CanonicalEvent, Memory } from '@brot/protocol';

/**
 * The thread view is a pure fold over canonical events (docs/ARCHITECTURE.md). Replaying the same
 * events always yields the same view, so live streams and stored history share one code path.
 * DMs and rooms share it too: a DM is a room with one bot.
 */

export type RunState = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'failed';

export type MessageItem = {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming: boolean;
  at: string;
  /** The bot that wrote it. For streamed text, the bot whose run produced it. */
  authorBotId?: string;
  mentions?: string[];
  /** Set when one bot addressed this message to another bot. */
  viaBotId?: string;
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

/** One `ask_bot` exchange: the question, and the answer once it arrives. */
export type ExchangeItem = {
  kind: 'exchange';
  askId: string;
  fromBotId: string;
  toBotId: string;
  question: string;
  answer?: string;
  at: string;
  answeredAt?: string;
};

export type HandoffItem = {
  kind: 'handoff';
  id: string;
  fromBotId: string;
  toBotId: string;
  note?: string;
  at: string;
};

/** A task created from this thread. Its live status comes from the task store, not from this item. */
export type TaskRefItem = { kind: 'task'; taskId: string; at: string };

export type TimelineItem = MessageItem | ToolItem | ApprovalItem | ExchangeItem | HandoffItem | TaskRefItem;

export interface RunCost {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export type ActiveRun = { botId?: string; state: 'running' | 'waiting_approval' };

export interface ThreadState {
  items: TimelineItem[];
  /** The most recent run's state. Rooms can run several bots at once; see `activeRuns`. */
  run: RunState;
  costByRun: Record<string, RunCost>;
  memories: Memory[];
  /** The bot behind each run seen in this thread. Lets streamed deltas carry their author. */
  runBots: Record<string, string>;
  /** Runs that have started and not finished yet. */
  activeRuns: Record<string, ActiveRun>;
  /** Room members after the latest `room.members` event. Absent until one arrives. */
  members?: string[];
  /** The bot that answers next after a handoff. */
  baton?: string;
}

export const emptyThread: ThreadState = {
  items: [],
  run: 'idle',
  costByRun: {},
  memories: [],
  runBots: {},
  activeRuns: {},
};

const runKey = (event: CanonicalEvent) => event.runId ?? 'default';

function settleStreaming(items: TimelineItem[]): TimelineItem[] {
  return items.map((item) => (item.kind === 'message' && item.streaming ? { ...item, streaming: false } : item));
}

function settleRun(items: TimelineItem[], authorBotId: string | undefined): TimelineItem[] {
  if (authorBotId === undefined) return settleStreaming(items);
  return items.map((item) =>
    item.kind === 'message' && item.streaming && (item.authorBotId === authorBotId || item.authorBotId === undefined)
      ? { ...item, streaming: false }
      : item,
  );
}

function replaceWhere<T extends TimelineItem>(
  items: TimelineItem[],
  match: (item: TimelineItem) => item is T,
  next: (prev: T) => TimelineItem,
): TimelineItem[] {
  return items.map((item) => (match(item) ? next(item) : item));
}

function withoutRun(active: Record<string, ActiveRun>, key: string): Record<string, ActiveRun> {
  if (!(key in active)) return active;
  const { [key]: _done, ...rest } = active;
  return rest;
}

export function applyEvent(state: ThreadState, event: CanonicalEvent): ThreadState {
  switch (event.type) {
    case 'run.started': {
      const key = runKey(event);
      return {
        ...state,
        run: 'running',
        runBots: { ...state.runBots, [key]: event.botId },
        activeRuns: { ...state.activeRuns, [key]: { botId: event.botId, state: 'running' } },
      };
    }

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
          authorBotId: state.runBots[runKey(event)],
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
      const authorBotId =
        message.authorBotId ?? (message.role === 'assistant' ? state.runBots[runKey(event)] : undefined);
      const next: MessageItem = {
        kind: 'message',
        id: message.id,
        role: message.role,
        content: message.content,
        streaming: false,
        at: message.createdAt,
        ...(authorBotId === undefined ? {} : { authorBotId }),
        ...(message.mentions === undefined ? {} : { mentions: message.mentions }),
        ...(message.viaBotId === undefined ? {} : { viaBotId: message.viaBotId }),
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
      const key = event.approval.runId;
      const activeRuns = { ...state.activeRuns, [key]: { botId: event.approval.botId, state: 'waiting_approval' as const } };
      if (state.items.some((item) => item.kind === 'approval' && item.approval.id === event.approval.id)) {
        return { ...state, run: 'waiting_approval', activeRuns };
      }
      const item: ApprovalItem = { kind: 'approval', approval: event.approval };
      return { ...state, run: 'waiting_approval', activeRuns, items: [...state.items, item] };
    }

    case 'approval.resolved': {
      const key = event.approval.runId;
      return {
        ...state,
        run: 'running',
        activeRuns: { ...state.activeRuns, [key]: { botId: event.approval.botId, state: 'running' } },
        items: replaceWhere(
          state.items,
          (item): item is ApprovalItem => item.kind === 'approval' && item.approval.id === event.approval.id,
          () => ({ kind: 'approval', approval: event.approval }),
        ),
      };
    }

    case 'memory.written': {
      const others = state.memories.filter((memory) => memory.id !== event.memory.id);
      return { ...state, memories: [...others, event.memory] };
    }

    case 'task.created': {
      if (state.items.some((item) => item.kind === 'task' && item.taskId === event.task.id)) return state;
      const item: TaskRefItem = { kind: 'task', taskId: event.task.id, at: event.at };
      return { ...state, items: [...state.items, item] };
    }

    case 'handoff': {
      const item: HandoffItem = {
        kind: 'handoff',
        id: event.id,
        fromBotId: event.fromBotId,
        toBotId: event.toBotId,
        ...(event.note === undefined ? {} : { note: event.note }),
        at: event.at,
      };
      const exists = state.items.some((entry) => entry.kind === 'handoff' && entry.id === event.id);
      return { ...state, baton: event.toBotId, items: exists ? state.items : [...state.items, item] };
    }

    case 'bot.asked': {
      if (state.items.some((item) => item.kind === 'exchange' && item.askId === event.askId)) return state;
      const item: ExchangeItem = {
        kind: 'exchange',
        askId: event.askId,
        fromBotId: event.fromBotId,
        toBotId: event.toBotId,
        question: event.question,
        at: event.at,
      };
      return { ...state, items: [...state.items, item] };
    }

    case 'bot.answered': {
      const exists = state.items.some((item) => item.kind === 'exchange' && item.askId === event.askId);
      if (!exists) {
        // The question was not seen (an older log, or it was shown in another thread). Keep the answer.
        const item: ExchangeItem = {
          kind: 'exchange',
          askId: event.askId,
          fromBotId: event.fromBotId,
          toBotId: event.toBotId,
          question: '',
          answer: event.answer,
          at: event.at,
          answeredAt: event.at,
        };
        return { ...state, items: [...state.items, item] };
      }
      return {
        ...state,
        items: replaceWhere(
          state.items,
          (item): item is ExchangeItem => item.kind === 'exchange' && item.askId === event.askId,
          (prev) => ({ ...prev, answer: event.answer, answeredAt: event.at }),
        ),
      };
    }

    case 'room.members':
      return { ...state, members: event.botIds };

    case 'computer.status':
    case 'network.blocked':
    case 'task.updated':
      return state;

    case 'cost.updated':
      return {
        ...state,
        costByRun: {
          ...state.costByRun,
          [runKey(event)]: {
            tokensIn: event.tokensIn,
            tokensOut: event.tokensOut,
            costUsd: event.costUsd,
          },
        },
      };

    case 'run.completed': {
      const key = runKey(event);
      const activeRuns = withoutRun(state.activeRuns, key);
      const stillRunning = Object.keys(activeRuns).length > 0;
      return {
        ...state,
        run: stillRunning ? 'running' : 'completed',
        activeRuns,
        items: settleRun(state.items, state.runBots[key]),
      };
    }

    case 'run.failed': {
      const key = runKey(event);
      const notice: MessageItem = {
        kind: 'message',
        id: `${event.id}:error`,
        role: 'system',
        content: event.error,
        streaming: false,
        at: event.at,
      };
      return {
        ...state,
        run: 'failed',
        activeRuns: withoutRun(state.activeRuns, key),
        items: [...settleRun(state.items, state.runBots[key]), notice],
      };
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

/** Questions still waiting for an answer. */
export function pendingAsks(state: ThreadState): ExchangeItem[] {
  return state.items.filter((item): item is ExchangeItem => item.kind === 'exchange' && item.answer === undefined);
}

/**
 * What one bot is doing in this thread: waiting on a human approval, working (a live run, or
 * answering a question), or idle.
 */
export function botActivity(state: ThreadState, botId: string): 'waiting' | 'working' | 'idle' {
  if (pendingApprovals(state).some((item) => item.approval.botId === botId)) return 'waiting';
  if (Object.values(state.activeRuns).some((run) => run.botId === botId)) return 'working';
  if (pendingAsks(state).some((ask) => ask.toBotId === botId)) return 'working';
  return 'idle';
}

/** The bot each pending asker is looking at, keyed by asker. The latest question wins. */
export function gazeTargets(state: ThreadState): Record<string, string> {
  const targets: Record<string, string> = {};
  for (const ask of pendingAsks(state)) targets[ask.fromBotId] = ask.toBotId;
  return targets;
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
