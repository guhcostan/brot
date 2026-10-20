import type {
  Approval,
  ApprovalDecision,
  ApprovalKind,
  Bot,
  CanonicalEvent,
  ComputerState,
  Device,
  Message,
  PostMessage,
  ResolveApproval,
  Takeover,
  Task,
  Thread,
} from '@brot/protocol';
import {
  CreateBot,
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  MAX_ROOM_BOTS,
  MIN_ROOM_BOTS,
  UpdateBot,
  UpdateRoomMembers,
  defaultEgressPolicy,
} from '@brot/protocol';
import {
  ScreenUnavailable,
  type BotEvent,
  type BrotClient,
  type ComputerInfo,
  type NewRoom,
  type NewTask,
  type Provider,
  type Room,
  type RoomMessage,
  type TaskFilter,
} from './client';
import { applyInput, navigate, newScreen, renderScreen, type FakeScreen } from './mockComputer';
import {
  DEMO_BOTS,
  DEMO_HISTORY,
  DEMO_ROOM_HISTORY,
  DEMO_ROOMS,
  DEMO_TASKS,
  OPEN_ASK,
  PENDING_SEND,
  TASK_EMAIL,
  TASK_EXPORT,
  LAUNCH_ROOM,
  dmThreadOf,
} from './fixtures';
import { findMentions } from '../mentions';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1).toString(36)}`;

/** How long the seeded open question waits before Tamu answers it. */
const OPEN_ASK_DELAY_MS = 30_000;

type Key = { botId: string } | { roomId: string };

const DEMO_PROVIDERS: Provider[] = [
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    configured: true,
    secretName: 'OPENCODE_API_KEY',
    models: [
      { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
      { id: 'opencode-go/deepseek-v4.1', label: 'DeepSeek V4.1' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    configured: false,
    secretName: 'DEEPSEEK_API_KEY',
    models: [{ id: 'deepseek/deepseek-v4.1', label: 'DeepSeek V4.1' }],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    configured: false,
    secretName: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'anthropic/claude-sonnet', label: 'Claude Sonnet' },
      { id: 'anthropic/claude-haiku', label: 'Claude Haiku' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    configured: false,
    secretName: 'OPENAI_API_KEY',
    models: [{ id: 'openai/gpt-5-mini', label: 'GPT-5 mini' }],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    configured: false,
    secretName: 'OPENROUTER_API_KEY',
    models: [{ id: 'openrouter/auto', label: 'Auto' }],
  },
];

const DEMO_DEVICES: Device[] = [
  {
    id: 'dev_phone',
    name: 'iPhone',
    role: 'full',
    publicKey: 'demo-public-key',
    createdAt: '2026-10-12T18:30:00.000Z',
    lastSeenAt: '2026-10-19T07:58:00.000Z',
  },
];

/** A URL the message names, else a page that fits the bot. */
function pickUrl(content: string, botId: string): string {
  const named = content.match(/\bhttps?:\/\/[^\s]+/i)?.[0] ?? content.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|dev|io|net|br|app)\b[^\s]*/i)?.[0];
  if (named) return named.startsWith('http') ? named : `https://${named}`;
  if (/linkedin/i.test(content) || botId === 'bot_ara') return 'https://www.linkedin.com/feed/';
  return `https://duckduckgo.com/?q=${encodeURIComponent(content.slice(0, 60))}`;
}

/**
 * An in-process stand-in for the server and its mock engine. It emits the same canonical events a
 * real run would, so the UI exercises the full fold, approval, streaming and team paths without a
 * backend. A DM message that mentions send, email, or reply asks for approval before "sending". In
 * a room, "ask" or "check" makes the responder ask another member, and "task", "delegate" or
 * "assign" makes it delegate a task.
 */
export function createMockClient(): BrotClient {
  const bots = new Map<string, Bot>(DEMO_BOTS.map((bot) => [bot.id, structuredClone(bot)]));
  const nameOf = (botId: string) => bots.get(botId)?.name ?? botId;
  const providers = DEMO_PROVIDERS.map((provider) => structuredClone(provider));
  const devices = DEMO_DEVICES.map((device) => ({ ...device }));
  const screens = new Map<string, FakeScreen>();
  const takeoverWaiters = new Map<string, () => void>();
  const listeners = new Set<(event: BotEvent) => void>();
  const histories = new Map<string, CanonicalEvent[]>();
  const approvals = new Map<string, { key: Key; approval: Approval }>();
  const waiting = new Map<string, (decision: ApprovalDecision, reply?: string) => void>();
  const rooms = new Map<string, Room>(DEMO_ROOMS.map((room) => [room.thread.id, structuredClone(room)]));
  const tasks = new Map<string, Task>(DEMO_TASKS.map((task) => [task.id, { ...task }]));
  const taskTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  const batons = new Map<string, string>();

  const storeKey = (key: Key) => ('botId' in key ? `dm:${key.botId}` : `room:${key.roomId}`);
  const threadIdOf = (key: Key) => ('botId' in key ? dmThreadOf(key.botId) : key.roomId);
  const keyOfThread = (threadId: string): Key =>
    rooms.has(threadId) ? { roomId: threadId } : { botId: threadId.replace(/^thread_/, '') };

  for (const bot of DEMO_BOTS) {
    const seed = [...(DEMO_HISTORY[bot.id] ?? [])];
    histories.set(storeKey({ botId: bot.id }), seed);
  }
  for (const [roomId, seed] of Object.entries(DEMO_ROOM_HISTORY)) {
    histories.set(storeKey({ roomId }), [...seed]);
    for (const event of seed) if (event.type === 'handoff') batons.set(roomId, event.toBotId);
  }
  approvals.set(PENDING_SEND.id, { key: { botId: PENDING_SEND.botId }, approval: PENDING_SEND });

  const screenOf = (bot: Bot): FakeScreen | undefined => {
    if (bot.computer === 'none') return undefined;
    let screen = screens.get(bot.id);
    if (!screen) {
      screen = newScreen(bot.id === 'bot_boto' ? 'ready' : 'stopped', bot.desktop === true);
      if (bot.id === 'bot_boto') navigate(screen, 'https://news.ycombinator.com/item?id=4242');
      screens.set(bot.id, screen);
    }
    screen.desktop = bot.desktop === true;
    return screen;
  };

  const infoOf = (botId: string): ComputerInfo => {
    const bot = bots.get(botId);
    if (!bot) throw new Error(`Unknown bot: ${botId}`);
    const screen = screenOf(bot);
    return {
      state: screen ? screen.state : 'none',
      desktop: screen?.desktop ?? false,
      width: DESKTOP_WIDTH,
      height: DESKTOP_HEIGHT,
      takeover: screen?.takeover ?? null,
    };
  };

  const record = (key: Key, event: CanonicalEvent) => {
    const list = histories.get(storeKey(key)) ?? [];
    list.push(event);
    histories.set(storeKey(key), list);
    for (const listener of listeners) listener({ ...key, event });
  };

  const base = (key: Key, runId?: string) => ({ id: nextId('evt'), at: now(), threadId: threadIdOf(key), runId });

  const saveTask = (next: Task) => {
    tasks.set(next.id, next);
    record(keyOfThread(next.threadId), { ...base(keyOfThread(next.threadId)), type: 'task.updated', task: next });
  };

  const updateTask = (taskId: string, patch: Partial<Task>) => {
    const current = tasks.get(taskId);
    if (!current) return;
    saveTask({ ...current, ...patch, updatedAt: now() });
  };

  const setComputerState = (botId: string, state: ComputerState) => {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen) return;
    screen.state = state;
    const key: Key = { botId };
    record(key, { ...base(key), type: 'computer.status', computerId: `cmp_${botId}`, botId, state });
  };

  /** Boots a stopped computer the way the server does: starting, then ready a moment later. */
  async function boot(botId: string): Promise<void> {
    const screen = screens.get(botId);
    if (!screen || screen.state === 'ready') return;
    if (screen.state !== 'starting') setComputerState(botId, 'starting');
    await sleep(1400);
    if (screen.state === 'starting') {
      setComputerState(botId, 'ready');
      navigate(screen, 'about:blank');
    }
  }

  const setTakeoverState = (botId: string, next: Omit<Takeover, 'botId' | 'at'>): Takeover => {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen || !screen.desktop) throw new Error('404 This bot has no desktop.');
    const takeover: Takeover = { botId, at: now(), ...next };
    screen.takeover = takeover;
    const key: Key = { botId };
    record(key, { ...base(key), type: 'computer.takeover', takeover });
    if (!takeover.active) {
      const resume = takeoverWaiters.get(botId);
      takeoverWaiters.delete(botId);
      resume?.();
    }
    return takeover;
  };

  async function step(key: Key, runId: string, tool: string, args: Record<string, unknown>, output: () => string, delayMs = 600, ok = true): Promise<void> {
    const callId = nextId('call');
    record(key, { ...base(key, runId), type: 'tool.call', callId, tool, args });
    await sleep(delayMs);
    record(key, { ...base(key, runId), type: 'tool.result', callId, ok, output: output() });
  }

  async function askApproval(key: Key, runId: string, botId: string, kind: ApprovalKind, tool: string, summary: string, args: Record<string, unknown>): Promise<ApprovalDecision> {
    const approval: Approval = {
      id: nextId('appr'),
      runId,
      threadId: threadIdOf(key),
      botId,
      kind,
      tool,
      summary,
      args,
      status: 'pending',
      createdAt: now(),
    };
    approvals.set(approval.id, { key, approval });
    record(key, { ...base(key, runId), type: 'approval.requested', approval });
    return new Promise<ApprovalDecision>((resolve) => {
      waiting.set(approval.id, (value) => resolve(value));
    });
  }

  /** A desktop bot drives its browser: open, read, and hand the screen to the person at a sign-in. */
  async function runDesktopAgent(botId: string, runId: string, content: string): Promise<void> {
    const key: Key = { botId };
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen) return;
    if (screen.state !== 'ready') await boot(botId);
    const url = pickUrl(content, botId);
    const page = () => JSON.stringify({ url: screen.url, title: screen.title });
    await step(key, runId, 'browser_open', { url }, () => {
      navigate(screen, url);
      return page();
    }, 900);
    await step(key, runId, 'browser_snapshot', {}, () => `${screen.title}\n  textbox "Search" [ref=2]\n  link "Home" [ref=4]\n  button "Sign in" [ref=7]`, 700);

    if (screen.page === 'signin') {
      const reason = 'LinkedIn asks for a sign-in. Please sign in on my screen, then give control back.';
      const callId = nextId('call');
      record(key, { ...base(key, runId), type: 'tool.call', callId, tool: 'request_takeover', args: { reason } });
      setTakeoverState(botId, { active: true, requestedBy: 'bot', reason });
      await new Promise<void>((resolve) => takeoverWaiters.set(botId, resolve));
      record(key, { ...base(key, runId), type: 'tool.result', callId, ok: true, output: 'Control is back. Take a new snapshot.' });
      await step(key, runId, 'browser_snapshot', {}, () => `${screen.title}\n  button "Start a post" [ref=31]`, 700);
      if (screen.page === 'signin') {
        await stream(key, runId, botId, 'The page still asks for a sign-in, so I stopped here. Take control again whenever you are ready.');
        finish(key, runId);
        return;
      }
      const decision = await askApproval(key, runId, botId, 'publish', 'browser_click', 'Post the release note on LinkedIn', { ref: 31, text: 'We just shipped Brot 0.4. A team of bots in a chat app.' });
      if (decision === 'deny') {
        await stream(key, runId, botId, 'Understood. The post stays a draft.');
        finish(key, runId);
        return;
      }
      await step(key, runId, 'browser_click', { ref: 31 }, page, 800);
      await stream(key, runId, botId, 'Posted. I will keep an eye on the comments.');
      finish(key, runId);
      return;
    }

    await step(key, runId, 'browser_click', { ref: 12 }, () => {
      if (screen.page === 'search' || screen.page === 'feed') screen.scroll = 120;
      return page();
    }, 700);
    await stream(key, runId, botId, `I opened ${screen.title} and read the page. The first results look relevant; tell me which one to dig into.`);
    finish(key, runId);
  }

  async function stream(key: Key, runId: string, botId: string, text: string): Promise<void> {
    const messageId = nextId('msg');
    for (const delta of text.split(/(?<=\s)/)) {
      record(key, { ...base(key, runId), type: 'message.delta', messageId, delta });
      await sleep(28);
    }
    const message: Message = {
      id: messageId,
      threadId: threadIdOf(key),
      role: 'assistant',
      content: text,
      createdAt: now(),
      authorBotId: botId,
    };
    record(key, { ...base(key, runId), type: 'message.completed', message });
  }

  function finish(key: Key, runId: string) {
    record(key, { ...base(key, runId), type: 'cost.updated', tokensIn: 120, tokensOut: 24, costUsd: 0.0004 });
    record(key, { ...base(key, runId), type: 'run.completed' });
  }

  async function runAgent(botId: string, content: string): Promise<void> {
    const key: Key = { botId };
    const runId = nextId('run');
    const bot = bots.get(botId);
    record(key, { ...base(key, runId), type: 'run.started', botId, engine: bot?.engine ?? 'mock', model: bot?.model ?? 'mock-1' });
    await sleep(250);

    if (bot?.desktop && bot.computer === 'sandbox') {
      await runDesktopAgent(botId, runId, content);
      return;
    }

    if (/\b(send|email|reply)\b/i.test(content)) {
      const args = { body: content };
      const decision = await askApproval(key, runId, botId, 'send', 'gmail.send', `Send the drafted follow-up for "${content.slice(0, 40)}"`, args);

      if (decision === 'deny') {
        await stream(key, runId, botId, 'Understood. I did not send it.');
        record(key, { ...base(key, runId), type: 'run.completed' });
        return;
      }

      await step(key, runId, 'gmail.send', args, () => 'Sent.', 400);
    }

    if (/\b(fail|break|crash)\b/i.test(content)) {
      await step(key, runId, 'shell', { command: 'npm test' }, () => '2 failing', 700, false);
      record(key, { ...base(key, runId), type: 'run.failed', error: 'Stopped. Two tests still fail, and I need your call on the fix.' });
      return;
    }

    await stream(key, runId, botId, 'On it. I will report back with the details shortly.');
    finish(key, runId);
  }

  /** Answers with the bot that the room's rules pick: mentions first, else the baton holder or lead. */
  function respondersFor(room: Room, mentions: string[]): string[] {
    const members = mentions.filter((botId) => room.memberIds.includes(botId));
    if (members.length > 0) return members;
    if (room.thread.responder === 'mention') return [];
    const baton = batons.get(room.thread.id);
    return [baton && room.memberIds.includes(baton) ? baton : (room.thread.leadBotId ?? room.thread.botId)];
  }

  async function runRoomAgent(room: Room, botId: string, content: string): Promise<void> {
    const key: Key = { roomId: room.thread.id };
    const runId = nextId('run');
    const other = room.memberIds.find((id) => id !== botId);
    record(key, { ...base(key, runId), type: 'run.started', botId, engine: 'mock', model: 'mock-1' });
    await sleep(500);

    if (other && /\b(ask|check)\b/i.test(content)) {
      const askId = nextId('ask');
      await stream(key, runId, botId, `Let me check with ${nameOf(other)}.`);
      record(key, {
        ...base(key, runId),
        type: 'bot.asked',
        askId,
        fromBotId: botId,
        toBotId: other,
        question: `Can you confirm this for me? "${content.slice(0, 80)}"`,
      });
      await sleep(2200);
      record(key, {
        ...base(key, runId),
        type: 'bot.answered',
        askId,
        fromBotId: botId,
        toBotId: other,
        answer: 'Confirmed. Nothing in my notes contradicts it.',
      });
      await stream(key, runId, botId, `${nameOf(other)} confirmed it. All set.`);
      finish(key, runId);
      return;
    }

    if (other && /\b(task|delegate|assign)\b/i.test(content)) {
      await stream(key, runId, botId, `I will hand this to ${nameOf(other)} and track it on the board.`);
      const created = makeTask({ title: content.replace(/@[\p{L}\p{N}_-]+\s*/gu, '').slice(0, 80) || 'Follow up', assigneeBotId: other, roomId: room.thread.id }, botId);
      record(key, { ...base(key), type: 'task.created', task: created });
      startTask(created.id);
      finish(key, runId);
      return;
    }

    await stream(key, runId, botId, 'Got it. I will take this one and post an update here.');
    finish(key, runId);
  }

  function makeTask(input: NewTask, createdByBotId?: string): Task {
    const id = nextId('task');
    const at = now();
    const parent = createdByBotId ? [...tasks.values()].find((entry) => entry.assigneeBotId === createdByBotId && entry.status === 'in_progress') : undefined;
    const created: Task = {
      id,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      status: 'open',
      assigneeBotId: input.assigneeBotId,
      createdByUser: createdByBotId === undefined,
      ...(createdByBotId ? { createdByBotId } : {}),
      ...(parent && parent.depth < 3 ? { parentTaskId: parent.id } : {}),
      threadId: input.roomId ?? dmThreadOf(input.assigneeBotId),
      chainId: parent && parent.depth < 3 ? parent.chainId : id,
      depth: createdByBotId === undefined ? 0 : parent && parent.depth < 3 ? parent.depth + 1 : 1,
      createdAt: at,
      updatedAt: at,
    };
    tasks.set(id, created);
    return created;
  }

  /** Walks a new task through in progress to done, the way an assignee's run would report it. */
  function startTask(taskId: string) {
    const timers = [
      setTimeout(() => updateTask(taskId, { status: 'in_progress', workThreadId: dmThreadOf(tasks.get(taskId)?.assigneeBotId ?? '') }), 900),
      setTimeout(() => {
        const current = tasks.get(taskId);
        if (!current || current.status !== 'in_progress') return;
        updateTask(taskId, { status: 'done', result: `Done. ${nameOf(current.assigneeBotId)} finished "${current.title}".` });
      }, 6000),
    ];
    taskTimers.set(taskId, timers);
  }

  let openAskScheduled = false;
  function scheduleOpenAsk() {
    if (openAskScheduled) return;
    openAskScheduled = true;
    setTimeout(() => {
      const key: Key = { roomId: LAUNCH_ROOM };
      record(key, {
        ...base(key, OPEN_ASK.runId),
        type: 'bot.answered',
        askId: OPEN_ASK.askId,
        fromBotId: OPEN_ASK.from,
        toBotId: OPEN_ASK.to,
        answer: 'Per request. Pages of 20k rows stay under it.',
      });
      void stream(key, OPEN_ASK.runId, OPEN_ASK.from, 'Per request, so pages of 20k rows keep us under the cap. The fix is in review.').then(() => {
        finish(key, OPEN_ASK.runId);
        updateTask(TASK_EXPORT, { status: 'done', result: 'Exports now stream in pages of 20k rows. Fix is in review.' });
      });
    }, OPEN_ASK_DELAY_MS);
  }

  return {
    async listBots(options = {}) {
      return [...bots.values()].filter((bot) => options.includeArchived || !bot.archived).map((bot) => structuredClone(bot));
    },

    async createBot(input) {
      const parsed = CreateBot.parse(input);
      const at = now();
      const { hostAcknowledged: _ack, ...fields } = parsed;
      const created: Bot = {
        ...fields,
        id: nextId('bot'),
        egress: parsed.egress ?? defaultEgressPolicy(),
        pinned: false,
        archived: false,
        createdAt: at,
        updatedAt: at,
      };
      bots.set(created.id, created);
      histories.set(storeKey({ botId: created.id }), []);
      return structuredClone(created);
    },

    async updateBot(botId, patch) {
      const current = bots.get(botId);
      if (!current) throw new Error(`Unknown bot: ${botId}`);
      const { teamBudgetUsd, hostAcknowledged: _ack, ...rest } = UpdateBot.parse(patch);
      const next: Bot = { ...current, ...rest, updatedAt: now() };
      if (teamBudgetUsd === null) delete next.teamBudgetUsd;
      else if (teamBudgetUsd !== undefined) next.teamBudgetUsd = teamBudgetUsd;
      if (next.computer !== 'sandbox') delete next.desktop;
      bots.set(botId, next);
      const screen = screens.get(botId);
      if (screen && (current.desktop !== next.desktop || next.computer === 'none')) screens.delete(botId);
      return structuredClone(next);
    },

    async deleteBot(botId) {
      if (!bots.delete(botId)) throw new Error(`Unknown bot: ${botId}`);
      histories.delete(storeKey({ botId }));
      screens.delete(botId);
      for (const room of rooms.values()) room.memberIds = room.memberIds.filter((id) => id !== botId);
    },

    async history(botId) {
      return [...(histories.get(storeKey({ botId })) ?? [])];
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async postMessage(botId: string, input: PostMessage) {
      const key: Key = { botId };
      if (!histories.has(storeKey(key))) throw new Error(`Unknown bot: ${botId}`);
      record(key, {
        ...base(key),
        type: 'message.completed',
        message: { id: nextId('msg'), threadId: threadIdOf(key), role: 'user', content: input.content, createdAt: now() },
      });
      void runAgent(botId, input.content);
    },

    async resolveApproval(approvalId: string, input: ResolveApproval) {
      const entry = approvals.get(approvalId);
      if (!entry) throw new Error(`Unknown approval: ${approvalId}`);
      if (entry.approval.status !== 'pending') return;

      const resolved: Approval = {
        ...entry.approval,
        status: input.decision === 'deny' ? 'denied' : 'allowed',
        decision: input.decision,
        reply: input.reply,
        resolvedAt: now(),
      };
      approvals.set(approvalId, { key: entry.key, approval: resolved });
      record(entry.key, { ...base(entry.key, resolved.runId), type: 'approval.resolved', approval: resolved });

      const resume = waiting.get(approvalId);
      if (resume) {
        waiting.delete(approvalId);
        resume(input.decision);
        return;
      }

      // No live run is waiting on this approval (seeded history), so close it out here.
      const botId = entry.approval.botId;
      if (input.decision === 'deny') {
        await stream(entry.key, resolved.runId, botId, input.reply ? `Not sent. Noted: ${input.reply}` : 'Not sent.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'cancelled', result: 'You declined the send.' });
      } else {
        const callId = nextId('call');
        record(entry.key, { ...base(entry.key, resolved.runId), type: 'tool.call', callId, tool: entry.approval.tool, args: entry.approval.args });
        await sleep(400);
        record(entry.key, { ...base(entry.key, resolved.runId), type: 'tool.result', callId, ok: true, output: 'Sent.' });
        await stream(entry.key, resolved.runId, botId, 'Sent. I will tell you when Ana replies.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'done', result: 'Sent to ana@acme.com.' });
      }
      record(entry.key, { ...base(entry.key, resolved.runId), type: 'run.completed' });
    },

    async listRooms() {
      return [...rooms.values()].map((room) => structuredClone(room));
    },

    async createRoom(input: NewRoom) {
      if (input.botIds.length < MIN_ROOM_BOTS || input.botIds.length > MAX_ROOM_BOTS) {
        throw new Error(`A room needs ${MIN_ROOM_BOTS} to ${MAX_ROOM_BOTS} bots.`);
      }
      if (!input.botIds.includes(input.leadBotId)) throw new Error('The lead bot must be a member.');
      const at = now();
      const thread: Thread = {
        id: nextId('room'),
        botId: input.leadBotId,
        title: input.title,
        kind: 'room',
        leadBotId: input.leadBotId,
        responder: input.responder,
        createdAt: at,
        updatedAt: at,
      };
      const created: Room = { thread, memberIds: [...input.botIds] };
      rooms.set(thread.id, created);
      const key: Key = { roomId: thread.id };
      histories.set(storeKey(key), []);
      record(key, { ...base(key), type: 'room.members', botIds: [...input.botIds] });
      return structuredClone(created);
    },

    async roomHistory(roomId) {
      if (roomId === LAUNCH_ROOM) scheduleOpenAsk();
      return [...(histories.get(storeKey({ roomId })) ?? [])];
    },

    async postRoomMessage(roomId: string, input: RoomMessage) {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`Unknown room: ${roomId}`);
      const key: Key = { roomId };
      const mentions = input.mentions ?? findMentions(
        input.content,
        [...bots.values()].filter((bot) => room.memberIds.includes(bot.id)),
      );
      record(key, {
        ...base(key),
        type: 'message.completed',
        message: {
          id: nextId('msg'),
          threadId: roomId,
          role: 'user',
          content: input.content,
          createdAt: now(),
          ...(mentions.length > 0 ? { mentions } : {}),
        },
      });
      const responders = respondersFor(room, mentions);
      void (async () => {
        for (const botId of responders) await runRoomAgent(room, botId, input.content);
      })();
    },

    async updateRoomMembers(roomId, change) {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`Unknown room: ${roomId}`);
      const { add = [], remove = [] } = UpdateRoomMembers.parse(change);
      const lead = room.thread.leadBotId ?? room.thread.botId;
      if (remove.includes(lead)) throw new Error('The lead bot cannot leave the room.');
      for (const botId of add) if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      const next = [...room.memberIds.filter((id) => !remove.includes(id)), ...add.filter((id) => !room.memberIds.includes(id))];
      if (next.length < MIN_ROOM_BOTS || next.length > MAX_ROOM_BOTS) {
        throw new Error(`A room needs ${MIN_ROOM_BOTS} to ${MAX_ROOM_BOTS} bots.`);
      }
      room.memberIds = next;
      const key: Key = { roomId };
      record(key, { ...base(key), type: 'room.members', botIds: [...next] });
      return [...next];
    },

    async listTasks(filter: TaskFilter = {}) {
      return [...tasks.values()].filter(
        (entry) =>
          (filter.assigneeBotId === undefined || entry.assigneeBotId === filter.assigneeBotId) &&
          (filter.status === undefined || entry.status === filter.status) &&
          (filter.chainId === undefined || entry.chainId === filter.chainId) &&
          (filter.threadId === undefined || entry.threadId === filter.threadId),
      );
    },

    async createTask(input: NewTask) {
      if (!input.title.trim()) throw new Error('A task needs a title.');
      const created = makeTask(input);
      const key = keyOfThread(created.threadId);
      record(key, { ...base(key), type: 'task.created', task: created });
      startTask(created.id);
      return { ...created };
    },

    async cancelTask(taskId: string) {
      const current = tasks.get(taskId);
      if (!current) throw new Error(`Unknown task: ${taskId}`);
      for (const timer of taskTimers.get(taskId) ?? []) clearTimeout(timer);
      taskTimers.delete(taskId);
      if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') return { ...current };
      updateTask(taskId, { status: 'cancelled' });
      return { ...tasks.get(taskId)! };
    },

    async listProviders() {
      return providers.map((provider) => structuredClone(provider));
    },

    async setSecret(name, value) {
      if (!value) throw new Error('A secret needs a value.');
      for (const provider of providers) if (provider.secretName === name) provider.configured = true;
    },

    async listDevices() {
      return devices.map((device) => ({ ...device }));
    },

    async removeDevice(deviceId) {
      const index = devices.findIndex((device) => device.id === deviceId);
      if (index < 0) throw new Error(`Unknown device: ${deviceId}`);
      devices.splice(index, 1);
    },

    async startPairing() {
      const code = String(100000 + Math.floor(Math.random() * 900000));
      const token = nextId('pair');
      return {
        token,
        code,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        qrPayload: `brot://pair?host=127.0.0.1&port=8799&token=${token}&code=${code}`,
      };
    },

    async getComputer(botId) {
      return infoOf(botId);
    },

    async startComputer(botId) {
      const info = infoOf(botId);
      if (info.state === 'none') throw new Error('This bot has no computer.');
      if (info.state === 'stopped' || info.state === 'error') void boot(botId);
      return infoOf(botId);
    },

    async computerScreen(botId) {
      const bot = bots.get(botId);
      const screen = bot ? screenOf(bot) : undefined;
      if (!screen || !screen.desktop) throw new ScreenUnavailable(404);
      if (screen.state !== 'ready') throw new ScreenUnavailable(409);
      return new Blob([renderScreen(screen)], { type: 'image/svg+xml' });
    },

    async computerInput(botId, input) {
      const screen = screens.get(botId);
      if (!screen?.takeover?.active) throw new Error('409 Take control first.');
      applyInput(screen, input);
    },

    async setTakeover(botId, input) {
      const previous = screens.get(botId)?.takeover;
      return setTakeoverState(botId, {
        active: input.active,
        ...(input.reason ? { reason: input.reason } : previous?.reason && !input.active ? { reason: previous.reason } : {}),
        requestedBy: input.active ? 'user' : (previous?.requestedBy ?? 'user'),
      });
    },
  };
}
