import type { Approval, Bot, CanonicalEvent } from '@brot/protocol';
import { parseAvatar, type AvatarMood, type AvatarSpec } from '@brot/ui/avatar';

/** Same set and wording as StatusDot in @brot/ui, which is a DOM component and not importable here. */
export const BOT_STATUSES = ['idle', 'working', 'waiting', 'error', 'ok', 'sleeping'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export const BOT_STATUS_LABELS: Record<BotStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting for you',
  error: 'Error',
  ok: 'Done',
  sleeping: 'Sleeping',
};

export const STATUS_MOOD: Record<BotStatus, AvatarMood> = {
  idle: 'idle',
  working: 'thinking',
  waiting: 'approval',
  error: 'error',
  ok: 'success',
  sleeping: 'sleeping',
};

export interface BotActivity {
  status: BotStatus;
  at: string;
  preview?: string;
}

export interface InboxState {
  bots: Bot[];
  /** Pending approvals only, by id. */
  approvals: Record<string, Approval>;
  activity: Record<string, BotActivity>;
  /** Thread to bot, learned from run.started and approvals so later events can be attributed. */
  threadBot: Record<string, string>;
}

export interface BotRow {
  bot: Bot;
  avatar: AvatarSpec;
  status: BotStatus;
  statusLabel: string;
  pending: number;
  preview?: string;
  lastActivityAt?: string;
}

const ts = (iso: string | undefined) => (iso === undefined ? 0 : Date.parse(iso));

export function initInbox(bots: Bot[], approvals: Approval[], previous?: InboxState): InboxState {
  const pending: Record<string, Approval> = {};
  const threadBot: Record<string, string> = { ...previous?.threadBot };
  for (const approval of approvals) {
    if (approval.status !== 'pending') continue;
    pending[approval.id] = approval;
    threadBot[approval.threadId] = approval.botId;
  }
  return { bots, approvals: pending, activity: { ...previous?.activity }, threadBot };
}

/** Records a thread's bot learned elsewhere, e.g. when a thread screen loads. */
export function rememberThread(state: InboxState, threadId: string, botId: string): InboxState {
  if (state.threadBot[threadId] === botId) return state;
  return { ...state, threadBot: { ...state.threadBot, [threadId]: botId } };
}

function withActivity(state: InboxState, botId: string, patch: Partial<BotActivity> & { at: string }): InboxState {
  const current = state.activity[botId];
  const next: BotActivity = { status: current?.status ?? 'idle', ...current, ...patch };
  return { ...state, activity: { ...state.activity, [botId]: next } };
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

export function applyInboxEvent(state: InboxState, event: CanonicalEvent): InboxState {
  if (event.type === 'run.started') {
    const learned = rememberThread(state, event.threadId, event.botId);
    return withActivity(learned, event.botId, { status: 'working', at: event.at });
  }
  if (event.type === 'approval.requested') {
    const { approval } = event;
    const learned = rememberThread(state, approval.threadId, approval.botId);
    const next = approval.status === 'pending' ? { ...learned, approvals: { ...learned.approvals, [approval.id]: approval } } : learned;
    return withActivity(next, approval.botId, { status: 'waiting', at: event.at });
  }
  if (event.type === 'approval.resolved') {
    const { approval } = event;
    const approvals = { ...state.approvals };
    delete approvals[approval.id];
    const stillWaiting = Object.values(approvals).some((other) => other.botId === approval.botId);
    const next = { ...state, approvals };
    if (stillWaiting) return next;
    return withActivity(next, approval.botId, { status: approval.status === 'denied' ? 'idle' : 'working', at: event.at });
  }

  const botId = state.threadBot[event.threadId];
  if (botId === undefined) return state;
  const waiting = Object.values(state.approvals).some((approval) => approval.botId === botId);

  switch (event.type) {
    case 'message.delta':
      return waiting ? state : withActivity(state, botId, { status: 'working', at: event.at });
    case 'message.completed':
      return withActivity(state, botId, { at: event.at, preview: snippet(event.message.content) });
    case 'run.completed':
      return withActivity(state, botId, { status: waiting ? 'waiting' : 'ok', at: event.at });
    case 'run.failed':
      return withActivity(state, botId, { status: 'error', at: event.at, preview: snippet(event.error) });
    default:
      return state;
  }
}

/** Approvals waiting on the human, oldest first: the top of the inbox. */
export function inboxApprovals(state: InboxState): Approval[] {
  return Object.values(state.approvals).sort((a, b) => ts(a.createdAt) - ts(b.createdAt));
}

/** Active bots: pinned first, then bots waiting on you, then most recent activity, then name. */
export function botRows(state: InboxState): BotRow[] {
  const rows = state.bots
    .filter((bot) => !bot.archived)
    .map((bot): BotRow => {
      const pending = Object.values(state.approvals).filter((approval) => approval.botId === bot.id).length;
      const activity = state.activity[bot.id];
      const status: BotStatus = pending > 0 ? 'waiting' : (activity?.status ?? 'idle');
      return {
        bot,
        avatar: parseAvatar(bot.avatar, bot.id),
        status,
        statusLabel: BOT_STATUS_LABELS[status],
        pending,
        preview: activity?.preview,
        lastActivityAt: activity?.at ?? bot.updatedAt,
      };
    });
  return rows.sort(
    (a, b) =>
      Number(b.bot.pinned) - Number(a.bot.pinned) ||
      Number(b.pending > 0) - Number(a.pending > 0) ||
      ts(b.lastActivityAt) - ts(a.lastActivityAt) ||
      a.bot.name.localeCompare(b.bot.name),
  );
}

export function botName(state: InboxState, botId: string): string {
  return state.bots.find((bot) => bot.id === botId)?.name ?? 'A bot';
}
