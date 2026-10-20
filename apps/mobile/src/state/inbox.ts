import type { Approval, Bot, CanonicalEvent, ComputerState, Takeover, Thread } from '@brot/protocol';
import { parseAvatar, type AvatarMood, type AvatarSpec } from '@brot/ui/avatar';
import { t } from '../i18n';

/** Same set and wording as StatusDot in @brot/ui, which is a DOM component and not importable here. */
export const BOT_STATUSES = ['idle', 'working', 'waiting', 'error', 'ok', 'sleeping'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export function botStatusLabel(status: BotStatus): string {
  return t(`status.${status}`);
}

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

/** What a bot last did on its desktop, for the computer status line. */
export interface ComputerActivity {
  tool: string;
  args: Record<string, unknown>;
  at: string;
}

export interface RoomActivity {
  at: string;
  preview?: string;
  authorBotId?: string;
}

export interface InboxState {
  bots: Bot[];
  /** Pending approvals only, by id. */
  approvals: Record<string, Approval>;
  activity: Record<string, BotActivity>;
  /** Thread to bot, learned from run.started and approvals so later events can be attributed. */
  threadBot: Record<string, string>;
  /** Run to bot, so events in a room (several bots, one thread) reach the right bot. */
  runBot: Record<string, string>;
  rooms: Thread[];
  /** Room id to member bot ids. */
  roomMembers: Record<string, string[]>;
  roomActivity: Record<string, RoomActivity>;
  /** Latest takeover per bot. Only active ones matter; inactive ones are kept to drop stale prompts. */
  takeovers: Record<string, Takeover>;
  computerActivity: Record<string, ComputerActivity>;
  computerState: Record<string, ComputerState>;
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
  return {
    bots,
    approvals: pending,
    activity: { ...previous?.activity },
    threadBot,
    runBot: { ...previous?.runBot },
    rooms: previous?.rooms ?? [],
    roomMembers: { ...previous?.roomMembers },
    roomActivity: { ...previous?.roomActivity },
    takeovers: { ...previous?.takeovers },
    computerActivity: { ...previous?.computerActivity },
    computerState: { ...previous?.computerState },
  };
}

/** Replaces the room list and their members after a fetch. */
export function withRooms(state: InboxState, rooms: Thread[], members: Record<string, string[]>): InboxState {
  return { ...state, rooms, roomMembers: { ...state.roomMembers, ...members } };
}

/** Records what a fetch of `GET /api/bots/:id/computer` said about takeover and state. */
export function withComputer(state: InboxState, botId: string, computer: { state: ComputerState | 'none'; takeover: Takeover | null }): InboxState {
  const takeovers = { ...state.takeovers };
  if (computer.takeover) takeovers[botId] = computer.takeover;
  else delete takeovers[botId];
  const computerState = { ...state.computerState };
  if (computer.state === 'none') delete computerState[botId];
  else computerState[botId] = computer.state;
  return { ...state, takeovers, computerState };
}

export function isRoom(state: InboxState, threadId: string): boolean {
  return state.rooms.some((room) => room.id === threadId);
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

function isBrowserTool(tool: string): boolean {
  return /(?:^|__|\.)(?:browser_\w+|computer_screenshot|request_takeover)$/.test(tool);
}

function withRoomActivity(state: InboxState, threadId: string, activity: RoomActivity): InboxState {
  return { ...state, roomActivity: { ...state.roomActivity, [threadId]: activity } };
}

export function applyInboxEvent(state: InboxState, event: CanonicalEvent): InboxState {
  if (event.type === 'run.started') {
    const room = isRoom(state, event.threadId);
    const learned = room ? state : rememberThread(state, event.threadId, event.botId);
    const withRun = event.runId ? { ...learned, runBot: { ...learned.runBot, [event.runId]: event.botId } } : learned;
    return withActivity(withRun, event.botId, { status: 'working', at: event.at });
  }
  if (event.type === 'computer.takeover') {
    return { ...state, takeovers: { ...state.takeovers, [event.takeover.botId]: event.takeover } };
  }
  if (event.type === 'computer.status') {
    return { ...state, computerState: { ...state.computerState, [event.botId]: event.state } };
  }
  if (event.type === 'room.members') {
    return { ...state, roomMembers: { ...state.roomMembers, [event.threadId]: event.botIds } };
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

  const runId = 'runId' in event ? event.runId : undefined;
  const botId = (runId ? state.runBot[runId] : undefined) ?? (isRoom(state, event.threadId) ? undefined : state.threadBot[event.threadId]);
  if (event.type === 'message.completed' && isRoom(state, event.threadId)) {
    const author = event.message.authorBotId ?? botId;
    const next = withRoomActivity(state, event.threadId, { at: event.at, preview: snippet(event.message.content), authorBotId: event.message.role === 'user' ? undefined : author });
    return author && event.message.role === 'assistant' ? withActivity(next, author, { at: event.at }) : next;
  }
  if (botId === undefined) return state;
  if (event.type === 'tool.call' && isBrowserTool(event.tool)) {
    return { ...state, computerActivity: { ...state.computerActivity, [botId]: { tool: event.tool, args: event.args, at: event.at } } };
  }
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
        statusLabel: botStatusLabel(status),
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
  return state.bots.find((bot) => bot.id === botId)?.name ?? t('common.aBot');
}

/** Active takeovers the bot asked for: the "needs you" prompts, oldest first. */
export function takeoverRequests(state: InboxState): Takeover[] {
  return Object.values(state.takeovers)
    .filter((takeover) => takeover.active && takeover.requestedBy === 'bot')
    .sort((a, b) => ts(a.at) - ts(b.at));
}

export interface RoomRow {
  room: Thread;
  members: Bot[];
  preview?: string;
  authorName?: string;
  lastActivityAt: string;
  /** Members working right now. */
  working: string[];
}

/** Rooms, most recently active first. Members keep the server's order with the lead bot first. */
export function roomRows(state: InboxState): RoomRow[] {
  return state.rooms
    .map((room): RoomRow => {
      const ids = state.roomMembers[room.id] ?? [room.leadBotId ?? room.botId];
      const lead = room.leadBotId ?? room.botId;
      const ordered = [...ids].sort((a, b) => Number(b === lead) - Number(a === lead));
      const members = ordered.map((id) => state.bots.find((bot) => bot.id === id)).filter((bot): bot is Bot => bot !== undefined);
      const activity = state.roomActivity[room.id];
      return {
        room,
        members,
        preview: activity?.preview,
        authorName: activity?.authorBotId ? botName(state, activity.authorBotId) : activity?.preview ? t('common.you') : undefined,
        lastActivityAt: activity?.at ?? room.updatedAt,
        working: members.filter((bot) => state.activity[bot.id]?.status === 'working').map((bot) => bot.id),
      };
    })
    .sort((a, b) => ts(b.lastActivityAt) - ts(a.lastActivityAt));
}
