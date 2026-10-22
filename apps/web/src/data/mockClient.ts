import type {
  Approval,
  ApprovalDecision,
  ApprovalKind,
  Attachment,
  Bot,
  CanonicalEvent,
  ComputerState,
  Device,
  Memory,
  Message,
  PostMessage,
  ResolveApproval,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  Skill,
  Takeover,
  Task,
  Team,
  Thread,
} from '@brot/protocol';
import {
  CreateBot,
  CreateMemory,
  CreateRoutine,
  CreateSkill,
  CreateTeam,
  CreateThread,
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  MAX_ROOM_BOTS,
  MIN_ROOM_BOTS,
  UpdateBot,
  UpdateMemory,
  UpdateRoomMembers,
  UpdateRoutine,
  UpdateSkill,
  UpdateTeam,
  UpdateThread,
  attachmentKindFor,
  defaultEgressPolicy,
  sanitizeAttachmentName,
} from '@brot/protocol';
import {
  ScreenUnavailable,
  type BotEvent,
  type BrotClient,
  type BrowserStatus,
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
  DEFAULT_THREAD_TITLE,
  DEMO_BOTS,
  DEMO_HISTORY,
  DEMO_MEMORIES,
  DEMO_ROOM_HISTORY,
  DEMO_ROOMS,
  DEMO_ROUTINE_RUNS,
  DEMO_ROUTINES,
  DEMO_SKILLS,
  DEMO_TASKS,
  DEMO_TEAMS,
  DEMO_THREAD_TITLES,
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

/** When the demo team's threads were last active. */
const SEEDED_AT = '2026-10-19T07:00:00.000Z';

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1).toString(36)}`;

/** How long the seeded open question waits before Tamu answers it. */
const OPEN_ASK_DELAY_MS = 30_000;

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

const byRecent = (threads: readonly Thread[]): Thread[] =>
  [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));

/**
 * The next occurrence of the cron presets the routine dialog writes, for the mock's schedule preview.
 * Anything fancier keeps no next run, like a disabled routine.
 */
function nextMockRunAt(cron: string, from = Date.now()): string | undefined {
  const [minuteField, hourField, dayField, monthField, weekdayField] = cron.trim().split(/\s+/);
  if (minuteField === undefined || hourField === undefined || dayField === undefined || monthField === undefined || weekdayField === undefined) return undefined;
  if (dayField !== '*' || monthField !== '*') return undefined;
  const date = new Date(from);
  date.setSeconds(0, 0);

  const step = /^\*\/(\d+)$/.exec(minuteField);
  if (step) {
    const size = Number(step[1]);
    if (!Number.isFinite(size) || size < 1 || size > 60) return undefined;
    date.setMinutes(date.getMinutes() + (size - (date.getMinutes() % size)), 0, 0);
    return date.toISOString();
  }
  if (hourField === '*') {
    const minute = Number(minuteField);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
    date.setMinutes(minute, 0, 0);
    if (date.getTime() <= from) date.setHours(date.getHours() + 1);
    return date.toISOString();
  }

  const minute = Number(minuteField);
  const hour = Number(hourField);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(hour) || hour < 0 || hour > 23) return undefined;
  const target = (daysAhead: number) => {
    const next = new Date(from);
    next.setDate(next.getDate() + daysAhead);
    next.setHours(hour, minute, 0, 0);
    return next.getTime() > from ? next.toISOString() : undefined;
  };
  if (weekdayField === '*') return target(1);
  const weekdays = /^1-5$/.test(weekdayField) ? [1, 2, 3, 4, 5] : /^[0-6]$/.test(weekdayField) ? [Number(weekdayField)] : undefined;
  if (weekdays === undefined) return undefined;
  for (let ahead = 1; ahead <= 8; ahead += 1) {
    const day = (new Date(from).getDay() + ahead) % 7;
    if (!weekdays.includes(day)) continue;
    const next = target(ahead);
    if (next !== undefined) return next;
  }
  return undefined;
}

/**
 * An in-process stand-in for the server and its mock engine. It emits the same canonical events a
 * real run would, so the UI exercises the full fold, approval, streaming and team paths without a
 * backend. Every bot has any number of DM threads; a message answers in the thread it was posted to.
 * In a DM, a message that mentions send, email, or reply asks for approval before "sending". In a
 * room, "ask" or "check" makes the responder ask another member, and "task", "delegate" or "assign"
 * makes it delegate a task.
 */
export function createMockClient(): BrotClient {
  const bots = new Map<string, Bot>(DEMO_BOTS.map((bot) => [bot.id, structuredClone(bot)]));
  const teams = new Map<string, Team>(DEMO_TEAMS.map((team) => [team.id, structuredClone(team)]));
  const nameOf = (botId: string) => bots.get(botId)?.name ?? botId;
  const byTeamName = (a: Team, b: Team) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  /** Mirrors the server: a chief must be a bot that exists and is not archived. */
  const requireChief = (chiefBotId: string | null | undefined) => {
    if (chiefBotId === undefined || chiefBotId === null) return;
    const chief = bots.get(chiefBotId);
    if (!chief || chief.archived) throw new Error(`Unknown bot: ${chiefBotId}`);
  };
  const clearChiefOf = (botId: string) => {
    for (const [teamId, team] of teams) {
      if (team.chiefBotId !== botId) continue;
      const cleared = { ...team };
      delete cleared.chiefBotId;
      teams.set(teamId, cleared);
    }
  };
  const providers = DEMO_PROVIDERS.map((provider) => structuredClone(provider));
  const devices = DEMO_DEVICES.map((device) => ({ ...device }));
  const screens = new Map<string, FakeScreen>();
  const browserStates = new Map<string, BrowserStatus['state']>();
  const takeoverWaiters = new Map<string, () => void>();
  const listeners = new Set<(event: BotEvent) => void>();
  /** Every event a thread has produced, keyed by thread id. */
  const histories = new Map<string, CanonicalEvent[]>();
  /** Every thread, DM or room, keyed by thread id. */
  const threads = new Map<string, Thread>();
  /** Each bot's DM threads, most recently active first. */
  const threadsOfBot = new Map<string, Thread[]>();
  const approvals = new Map<string, { threadId: string; approval: Approval }>();
  const waiting = new Map<string, (decision: ApprovalDecision, reply?: string) => void>();
  const rooms = new Map<string, Room>();
  const tasks = new Map<string, Task>(DEMO_TASKS.map((task) => [task.id, { ...task }]));
  const taskTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  const batons = new Map<string, string>();
  /** Uploaded attachment metadata and the conversation it was uploaded to, keyed by attachment id. */
  const attachments = new Map<string, { attachment: Attachment; threadId: string }>();
  const memories = new Map<string, Memory>(DEMO_MEMORIES.map((memory) => [memory.id, structuredClone(memory)]));
  const skills = new Map<string, Skill>(DEMO_SKILLS.map((skill) => [skill.id, structuredClone(skill)]));
  const routines = new Map<string, Routine>(DEMO_ROUTINES.map((routine) => [routine.id, structuredClone(routine)]));
  /** Runs per routine, newest first. */
  const routineRuns = new Map<string, RoutineRun[]>();
  /** Routines with a run still in flight, for the 409 the server answers with. */
  const runningRoutines = new Set<string>();

  for (const run of DEMO_ROUTINE_RUNS) {
    const list = routineRuns.get(run.routineId) ?? [];
    list.push(structuredClone(run));
    routineRuns.set(run.routineId, list);
  }

  const dmThreadsOf = (botId: string): Thread[] => threadsOfBot.get(botId) ?? [];
  const defaultThreadOf = (botId: string): Thread | undefined => dmThreadsOf(botId)[0];

  const targetOf = (threadId: string): { botId: string } | { roomId: string } | undefined => {
    const thread = threads.get(threadId);
    if (!thread) return undefined;
    return thread.kind === 'room' ? { roomId: threadId } : { botId: thread.botId };
  };

  const record = (threadId: string, event: CanonicalEvent) => {
    const list = histories.get(threadId) ?? [];
    list.push(event);
    histories.set(threadId, list);
    const target = targetOf(threadId);
    for (const listener of listeners) listener({ threadId, ...target, event });
  };

  const base = (threadId: string, runId?: string) => ({ id: nextId('evt'), at: now(), threadId, runId });

  function remember(thread: Thread): Thread {
    threads.set(thread.id, thread);
    return thread;
  }

  function rememberDm(thread: Thread): Thread {
    remember(thread);
    threadsOfBot.set(thread.botId, byRecent([thread, ...dmThreadsOf(thread.botId).filter((entry) => entry.id !== thread.id)]));
    return thread;
  }

  function touch(threadId: string): void {
    const thread = threads.get(threadId);
    if (!thread || thread.kind === 'room') return;
    const next = { ...thread, updatedAt: now() };
    rememberDm(next);
  }

  function createThreadFor(botId: string, title?: string): Thread {
    const at = now();
    const thread: Thread = {
      id: nextId('thread'),
      botId,
      title: title ?? DEFAULT_THREAD_TITLE,
      kind: 'dm',
      createdAt: at,
      updatedAt: at,
    };
    histories.set(thread.id, []);
    return rememberDm(thread);
  }

  function ensureDefaultThread(botId: string): Thread {
    const thread = defaultThreadOf(botId);
    if (thread) return thread;
    if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
    return createThreadFor(botId);
  }

  const routineThreadOf = (botId: string) => defaultThreadOf(botId)?.id ?? createThreadFor(botId).id;

  const scheduledRuns = (): RoutineRun[] =>
    [...routineRuns.values()].flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id));

  /** Links uploaded attachment ids to a message the way the server does, or throws like its 400. */
  function linkAttachments(threadId: string, ids: readonly string[] | undefined, messageId: string): Attachment[] {
    const linked: Attachment[] = [];
    for (const id of ids ?? []) {
      const entry = attachments.get(id);
      if (!entry) throw new Error(`Unknown attachment: ${id}`);
      if (entry.threadId !== threadId) throw new Error('This attachment belongs to another thread');
      if (entry.attachment.messageId !== undefined) throw new Error('This attachment is already linked to a message');
      linked.push({ ...entry.attachment, messageId });
    }
    for (const attachment of linked) {
      const entry = attachments.get(attachment.id);
      if (entry) attachments.set(attachment.id, { ...entry, attachment });
    }
    return linked;
  }

  function seededThread(botId: string): Thread {
    const at = SEEDED_AT;
    const thread: Thread = {
      id: dmThreadOf(botId),
      botId,
      title: DEMO_THREAD_TITLES[botId] ?? DEFAULT_THREAD_TITLE,
      kind: 'dm',
      createdAt: at,
      updatedAt: at,
    };
    threads.set(thread.id, thread);
    threadsOfBot.set(botId, [thread]);
    histories.set(thread.id, [...(DEMO_HISTORY[botId] ?? [])]);
    return thread;
  }

  for (const bot of DEMO_BOTS) seededThread(bot.id);
  for (const room of DEMO_ROOMS) {
    const created = structuredClone(room);
    rooms.set(created.thread.id, created);
    remember(created.thread);
    const seed = [...(DEMO_ROOM_HISTORY[created.thread.id] ?? [])];
    histories.set(created.thread.id, seed);
    for (const event of seed) if (event.type === 'handoff') batons.set(created.thread.id, event.toBotId);
  }
  approvals.set(PENDING_SEND.id, { threadId: PENDING_SEND.threadId, approval: PENDING_SEND });

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

  /** Mirrors the server: only a bot with `browser: true` has a host browser. */
  const hostBrowserOf = (botId: string): Bot => {
    const bot = bots.get(botId);
    if (!bot) throw new Error(`Unknown bot: ${botId}`);
    if (bot.browser !== true) throw new Error('409 This bot has no browser.');
    return bot;
  };

  /** A sandbox with a desktop already has a browser, so the server refuses a sign-in window for it. */
  const loginBotOf = (botId: string): Bot => {
    const bot = hostBrowserOf(botId);
    if (bot.computer === 'sandbox' && bot.desktop === true) {
      throw new Error('409 This bot already has a browser in its desktop.');
    }
    return bot;
  };

  const saveTask = (next: Task) => {
    tasks.set(next.id, next);
    record(next.threadId, { ...base(next.threadId), type: 'task.updated', task: next });
  };

  const updateTask = (taskId: string, patch: Partial<Task>) => {
    const current = tasks.get(taskId);
    if (!current) return;
    saveTask({ ...current, ...patch, updatedAt: now() });
  };

  const setComputerState = (botId: string, threadId: string, state: ComputerState) => {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen) return;
    screen.state = state;
    record(threadId, { ...base(threadId), type: 'computer.status', computerId: `cmp_${botId}`, botId, state });
  };

  /** Boots a stopped computer the way the server does: starting, then ready a moment later. */
  async function boot(botId: string, threadId: string): Promise<void> {
    const screen = screens.get(botId);
    if (!screen || screen.state === 'ready') return;
    if (screen.state !== 'starting') setComputerState(botId, threadId, 'starting');
    await sleep(1400);
    if (screen.state === 'starting') {
      setComputerState(botId, threadId, 'ready');
      navigate(screen, 'about:blank');
    }
  }

  const setTakeoverState = (botId: string, threadId: string, next: Omit<Takeover, 'botId' | 'at'>): Takeover => {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen || !screen.desktop) throw new Error('404 This bot has no desktop.');
    const takeover: Takeover = { botId, at: now(), ...next };
    screen.takeover = takeover;
    record(threadId, { ...base(threadId), type: 'computer.takeover', takeover });
    if (!takeover.active) {
      const resume = takeoverWaiters.get(botId);
      takeoverWaiters.delete(botId);
      resume?.();
    }
    return takeover;
  };

  async function step(threadId: string, runId: string, tool: string, args: Record<string, unknown>, output: () => string, delayMs = 600, ok = true): Promise<void> {
    const callId = nextId('call');
    record(threadId, { ...base(threadId, runId), type: 'tool.call', callId, tool, args });
    await sleep(delayMs);
    record(threadId, { ...base(threadId, runId), type: 'tool.result', callId, ok, output: output() });
  }

  async function askApproval(threadId: string, runId: string, botId: string, kind: ApprovalKind, tool: string, summary: string, args: Record<string, unknown>): Promise<ApprovalDecision> {
    const approval: Approval = {
      id: nextId('appr'),
      runId,
      threadId,
      botId,
      kind,
      tool,
      summary,
      args,
      status: 'pending',
      createdAt: now(),
    };
    approvals.set(approval.id, { threadId, approval });
    record(threadId, { ...base(threadId, runId), type: 'approval.requested', approval });
    return new Promise<ApprovalDecision>((resolve) => {
      waiting.set(approval.id, (value) => resolve(value));
    });
  }

  /** A desktop bot drives its browser: open, read, and hand the screen to the person at a sign-in. */
  async function runDesktopAgent(botId: string, threadId: string, runId: string, content: string): Promise<void> {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen) return;
    if (screen.state !== 'ready') await boot(botId, threadId);
    const url = pickUrl(content, botId);
    const page = () => JSON.stringify({ url: screen.url, title: screen.title });
    await step(threadId, runId, 'browser_open', { url }, () => {
      navigate(screen, url);
      return page();
    }, 900);
    await step(threadId, runId, 'browser_snapshot', {}, () => `${screen.title}\n  textbox "Search" [ref=2]\n  link "Home" [ref=4]\n  button "Sign in" [ref=7]`, 700);

    if (screen.page === 'signin') {
      const reason = 'LinkedIn asks for a sign-in. Please sign in on my screen, then give control back.';
      const callId = nextId('call');
      record(threadId, { ...base(threadId, runId), type: 'tool.call', callId, tool: 'request_takeover', args: { reason } });
      setTakeoverState(botId, threadId, { active: true, requestedBy: 'bot', reason });
      await new Promise<void>((resolve) => takeoverWaiters.set(botId, resolve));
      record(threadId, { ...base(threadId, runId), type: 'tool.result', callId, ok: true, output: 'Control is back. Take a new snapshot.' });
      await step(threadId, runId, 'browser_snapshot', {}, () => `${screen.title}\n  button "Start a post" [ref=31]`, 700);
      if (screen.page === 'signin') {
        await stream(threadId, runId, botId, 'The page still asks for a sign-in, so I stopped here. Take control again whenever you are ready.');
        finish(threadId, runId);
        return;
      }
      const decision = await askApproval(threadId, runId, botId, 'publish', 'browser_click', 'Post the release note on LinkedIn', { ref: 31, text: 'We just shipped Brot 0.4. A team of bots in a chat app.' });
      if (decision === 'deny') {
        await stream(threadId, runId, botId, 'Understood. The post stays a draft.');
        finish(threadId, runId);
        return;
      }
      await step(threadId, runId, 'browser_click', { ref: 31 }, page, 800);
      await stream(threadId, runId, botId, 'Posted. I will keep an eye on the comments.');
      finish(threadId, runId);
      return;
    }

    await step(threadId, runId, 'browser_click', { ref: 12 }, () => {
      if (screen.page === 'search' || screen.page === 'feed') screen.scroll = 120;
      return page();
    }, 700);
    await stream(threadId, runId, botId, `I opened ${screen.title} and read the page. The first results look relevant; tell me which one to dig into.`);
    finish(threadId, runId);
  }

  async function stream(threadId: string, runId: string, botId: string, text: string): Promise<void> {
    const messageId = nextId('msg');
    for (const delta of text.split(/(?<=\s)/)) {
      record(threadId, { ...base(threadId, runId), type: 'message.delta', messageId, delta });
      await sleep(28);
    }
    const message: Message = {
      id: messageId,
      threadId,
      role: 'assistant',
      content: text,
      createdAt: now(),
      authorBotId: botId,
    };
    record(threadId, { ...base(threadId, runId), type: 'message.completed', message });
  }

  function finish(threadId: string, runId: string) {
    record(threadId, { ...base(threadId, runId), type: 'cost.updated', tokensIn: 120, tokensOut: 24, costUsd: 0.0004 });
    record(threadId, { ...base(threadId, runId), type: 'run.completed' });
  }

  async function runAgent(botId: string, threadId: string, content: string): Promise<void> {
    const runId = nextId('run');
    const bot = bots.get(botId);
    record(threadId, { ...base(threadId, runId), type: 'run.started', botId, engine: bot?.engine ?? 'mock', model: bot?.model ?? 'mock-1' });
    await sleep(250);

    if (bot?.desktop && bot.computer === 'sandbox') {
      await runDesktopAgent(botId, threadId, runId, content);
      return;
    }

    if (/\b(send|email|reply)\b/i.test(content)) {
      const args = { body: content };
      const decision = await askApproval(threadId, runId, botId, 'send', 'gmail.send', `Send the drafted follow-up for "${content.slice(0, 40)}"`, args);

      if (decision === 'deny') {
        await stream(threadId, runId, botId, 'Understood. I did not send it.');
        record(threadId, { ...base(threadId, runId), type: 'run.completed' });
        return;
      }

      await step(threadId, runId, 'gmail.send', args, () => 'Sent.', 400);
    }

    if (/\b(fail|break|crash)\b/i.test(content)) {
      await step(threadId, runId, 'shell', { command: 'npm test' }, () => '2 failing', 700, false);
      record(threadId, { ...base(threadId, runId), type: 'run.failed', error: 'Stopped. Two tests still fail, and I need your call on the fix.' });
      return;
    }

    await stream(threadId, runId, botId, 'On it. I will report back with the details shortly.');
    finish(threadId, runId);
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
    const threadId = room.thread.id;
    const runId = nextId('run');
    const other = room.memberIds.find((id) => id !== botId);
    record(threadId, { ...base(threadId, runId), type: 'run.started', botId, engine: 'mock', model: 'mock-1' });
    await sleep(500);

    if (other && /\b(ask|check)\b/i.test(content)) {
      const askId = nextId('ask');
      await stream(threadId, runId, botId, `Let me check with ${nameOf(other)}.`);
      record(threadId, {
        ...base(threadId, runId),
        type: 'bot.asked',
        askId,
        fromBotId: botId,
        toBotId: other,
        question: `Can you confirm this for me? "${content.slice(0, 80)}"`,
      });
      await sleep(2200);
      record(threadId, {
        ...base(threadId, runId),
        type: 'bot.answered',
        askId,
        fromBotId: botId,
        toBotId: other,
        answer: 'Confirmed. Nothing in my notes contradicts it.',
      });
      await stream(threadId, runId, botId, `${nameOf(other)} confirmed it. All set.`);
      finish(threadId, runId);
      return;
    }

    if (other && /\b(task|delegate|assign)\b/i.test(content)) {
      await stream(threadId, runId, botId, `I will hand this to ${nameOf(other)} and track it on the board.`);
      const created = makeTask({ title: content.replace(/@[\p{L}\p{N}_-]+\s*/gu, '').slice(0, 80) || 'Follow up', assigneeBotId: other, roomId: threadId }, botId);
      record(threadId, { ...base(threadId), type: 'task.created', task: created });
      startTask(created.id);
      finish(threadId, runId);
      return;
    }

    await stream(threadId, runId, botId, 'Got it. I will take this one and post an update here.');
    finish(threadId, runId);
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
      threadId: input.roomId ?? ensureDefaultThread(input.assigneeBotId).id,
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
      setTimeout(() => {
        const current = tasks.get(taskId);
        if (!current) return;
        const workThreadId = defaultThreadOf(current.assigneeBotId)?.id;
        updateTask(taskId, { status: 'in_progress', ...(workThreadId ? { workThreadId } : {}) });
      }, 900),
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
      record(LAUNCH_ROOM, {
        ...base(LAUNCH_ROOM, OPEN_ASK.runId),
        type: 'bot.answered',
        askId: OPEN_ASK.askId,
        fromBotId: OPEN_ASK.from,
        toBotId: OPEN_ASK.to,
        answer: 'Per request. Pages of 20k rows stay under it.',
      });
      void stream(LAUNCH_ROOM, OPEN_ASK.runId, OPEN_ASK.from, 'Per request, so pages of 20k rows keep us under the cap. The fix is in review.').then(() => {
        finish(LAUNCH_ROOM, OPEN_ASK.runId);
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
      if (created.browser === true) browserStates.set(created.id, 'stopped');
      return structuredClone(created);
    },

    async updateBot(botId, patch) {
      const current = bots.get(botId);
      if (!current) throw new Error(`Unknown bot: ${botId}`);
      const { teamBudgetUsd, teamId, hostAcknowledged: _ack, ...rest } = UpdateBot.parse(patch);
      const next: Bot = { ...current, ...rest, updatedAt: now() };
      if (teamBudgetUsd === null) delete next.teamBudgetUsd;
      else if (teamBudgetUsd !== undefined) next.teamBudgetUsd = teamBudgetUsd;
      if (teamId === null) delete next.teamId;
      else if (teamId !== undefined) next.teamId = teamId;
      if (next.computer !== 'sandbox') delete next.desktop;
      bots.set(botId, next);
      const screen = screens.get(botId);
      if (screen && (current.desktop !== next.desktop || next.computer === 'none')) screens.delete(botId);
      if (next.browser !== true || (next.computer === 'sandbox' && next.desktop === true)) browserStates.delete(botId);
      return structuredClone(next);
    },

    async deleteBot(botId) {
      if (!bots.delete(botId)) throw new Error(`Unknown bot: ${botId}`);
      clearChiefOf(botId);
      for (const thread of dmThreadsOf(botId)) {
        threads.delete(thread.id);
        histories.delete(thread.id);
      }
      threadsOfBot.delete(botId);
      screens.delete(botId);
      browserStates.delete(botId);
      for (const [attachmentId, entry] of attachments) {
        if (threads.has(entry.threadId)) continue;
        attachments.delete(attachmentId);
      }
      for (const [memoryId, memory] of memories) if (memory.botId === botId) memories.delete(memoryId);
      for (const [skillId, skill] of skills) if (skill.botId === botId) skills.delete(skillId);
      for (const room of rooms.values()) room.memberIds = room.memberIds.filter((id) => id !== botId);
    },

    async listTeams() {
      return [...teams.values()].map((team) => structuredClone(team)).sort(byTeamName);
    },

    async createTeam(input) {
      const data = CreateTeam.parse(input);
      requireChief(data.chiefBotId);
      const at = now();
      const created: Team = {
        id: nextId('team'),
        name: data.name,
        instructions: data.instructions,
        ...(data.chiefBotId === undefined ? {} : { chiefBotId: data.chiefBotId }),
        createdAt: at,
        updatedAt: at,
      };
      teams.set(created.id, created);
      return structuredClone(created);
    },

    async updateTeam(teamId, patch) {
      const current = teams.get(teamId);
      if (!current) throw new Error(`Unknown team: ${teamId}`);
      const data = UpdateTeam.parse(patch);
      requireChief(data.chiefBotId);
      const next: Team = {
        id: current.id,
        name: data.name ?? current.name,
        instructions: data.instructions ?? current.instructions,
        createdAt: current.createdAt,
        updatedAt: now(),
      };
      const chiefBotId = data.chiefBotId === undefined ? current.chiefBotId : (data.chiefBotId ?? undefined);
      if (chiefBotId !== undefined) next.chiefBotId = chiefBotId;
      teams.set(teamId, next);
      return structuredClone(next);
    },

    async deleteTeam(teamId) {
      if (!teams.delete(teamId)) throw new Error(`Unknown team: ${teamId}`);
      const at = now();
      for (const [botId, bot] of bots) {
        if (bot.teamId !== teamId) continue;
        const ungrouped = { ...bot, updatedAt: at };
        delete ungrouped.teamId;
        bots.set(botId, ungrouped);
      }
    },

    async listMemories(botId) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      return [...memories.values()]
        .filter((memory) => memory.botId === botId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
        .map((memory) => structuredClone(memory));
    },

    async createMemory(botId, input) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      const data = CreateMemory.parse(input);
      const at = now();
      const created: Memory = { id: nextId('mem'), botId, kind: data.kind, content: data.content, createdAt: at, updatedAt: at };
      memories.set(created.id, created);
      return structuredClone(created);
    },

    async updateMemory(memoryId, patch) {
      const current = memories.get(memoryId);
      if (!current) throw new Error(`Unknown memory: ${memoryId}`);
      const data = UpdateMemory.parse(patch);
      const next: Memory = {
        ...current,
        ...(data.kind === undefined ? {} : { kind: data.kind }),
        ...(data.content === undefined ? {} : { content: data.content }),
        updatedAt: now(),
      };
      memories.set(memoryId, next);
      return structuredClone(next);
    },

    async deleteMemory(memoryId) {
      if (!memories.delete(memoryId)) throw new Error(`Unknown memory: ${memoryId}`);
    },

    async listSkills(botId?: string) {
      if (botId !== undefined && !bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      return [...skills.values()]
        .filter((skill) => botId === undefined || skill.botId === botId || skill.botId === undefined)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((skill) => structuredClone(skill));
    },

    async createSkill(input) {
      const data = CreateSkill.parse(input);
      if (data.botId !== undefined && !bots.has(data.botId)) throw new Error(`Unknown bot: ${data.botId}`);
      const at = now();
      const created: Skill = {
        id: nextId('skill'),
        ...(data.botId === undefined ? {} : { botId: data.botId }),
        name: data.name,
        description: data.description,
        body: data.body,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      skills.set(created.id, created);
      return structuredClone(created);
    },

    async updateSkill(skillId, patch) {
      const current = skills.get(skillId);
      if (!current) throw new Error(`Unknown skill: ${skillId}`);
      const data = UpdateSkill.parse(patch);
      const next: Skill = {
        ...current,
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.description === undefined ? {} : { description: data.description }),
        ...(data.body === undefined ? {} : { body: data.body }),
        ...(data.botId === undefined ? {} : { botId: data.botId }),
        version: current.version + 1,
        updatedAt: now(),
      };
      skills.set(skillId, next);
      return structuredClone(next);
    },

    async deleteSkill(skillId) {
      if (!skills.delete(skillId)) throw new Error(`Unknown skill: ${skillId}`);
    },

    async uploadAttachment(threadId, file) {
      if (!threads.has(threadId)) throw new Error(`Unknown thread: ${threadId}`);
      const mimeType = file.type === '' ? 'application/octet-stream' : file.type;
      const attachment: Attachment = {
        id: nextId('att'),
        name: sanitizeAttachmentName(file.name),
        mimeType,
        size: Math.max(file.size, 1),
        kind: attachmentKindFor(mimeType),
        createdAt: now(),
      };
      attachments.set(attachment.id, { attachment, threadId });
      return structuredClone(attachment);
    },

    async deleteAttachment(attachmentId) {
      const entry = attachments.get(attachmentId);
      if (!entry) throw new Error(`Unknown attachment: ${attachmentId}`);
      if (entry.attachment.messageId !== undefined) throw new Error('409 This attachment belongs to a message and cannot be deleted');
      attachments.delete(attachmentId);
    },

    async listThreads(botId) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      return byRecent(dmThreadsOf(botId)).map((thread) => structuredClone(thread));
    },

    async createThread(botId, input) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      const data = CreateThread.parse(input ?? {});
      return structuredClone(createThreadFor(botId, data.title));
    },

    async renameThread(threadId, title) {
      const data = UpdateThread.parse({ title });
      const thread = threads.get(threadId);
      if (!thread) throw new Error(`Unknown thread: ${threadId}`);
      const next = { ...thread, title: data.title, updatedAt: now() };
      remember(next);
      if (next.kind === 'room') {
        const room = rooms.get(threadId);
        if (room) rooms.set(threadId, { ...room, thread: next });
      } else {
        rememberDm(next);
      }
      return structuredClone(next);
    },

    async history(threadId) {
      return [...(histories.get(threadId) ?? [])];
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async postMessage(threadId, input: PostMessage) {
      const thread = threads.get(threadId);
      if (!thread || thread.kind === 'room') throw new Error(`Unknown thread: ${threadId}`);
      const messageId = nextId('msg');
      const linked = linkAttachments(threadId, input.attachmentIds, messageId);
      record(threadId, {
        ...base(threadId),
        type: 'message.completed',
        message: {
          id: messageId,
          threadId,
          role: 'user',
          content: input.content,
          createdAt: now(),
          ...(linked.length > 0 ? { attachments: linked } : {}),
        },
      });
      touch(threadId);
      void runAgent(thread.botId, threadId, input.content);
    },

    async resolveApproval(approvalId, input: ResolveApproval) {
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
      approvals.set(approvalId, { threadId: entry.threadId, approval: resolved });
      record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'approval.resolved', approval: resolved });

      const resume = waiting.get(approvalId);
      if (resume) {
        waiting.delete(approvalId);
        resume(input.decision);
        return;
      }

      // No live run is waiting on this approval (seeded history), so close it out here.
      const botId = entry.approval.botId;
      if (input.decision === 'deny') {
        await stream(entry.threadId, resolved.runId, botId, input.reply ? `Not sent. Noted: ${input.reply}` : 'Not sent.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'cancelled', result: 'You declined the send.' });
      } else {
        const callId = nextId('call');
        record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'tool.call', callId, tool: entry.approval.tool, args: entry.approval.args });
        await sleep(400);
        record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'tool.result', callId, ok: true, output: 'Sent.' });
        await stream(entry.threadId, resolved.runId, botId, 'Sent. I will tell you when Ana replies.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'done', result: 'Sent to ana@acme.com.' });
      }
      record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'run.completed' });
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
      remember(thread);
      rooms.set(thread.id, created);
      histories.set(thread.id, []);
      record(thread.id, { ...base(thread.id), type: 'room.members', botIds: [...input.botIds] });
      return structuredClone(created);
    },

    async roomHistory(roomId) {
      if (roomId === LAUNCH_ROOM) scheduleOpenAsk();
      return [...(histories.get(roomId) ?? [])];
    },

    async postRoomMessage(roomId: string, input: RoomMessage) {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`Unknown room: ${roomId}`);
      const mentions = input.mentions ?? findMentions(
        input.content,
        [...bots.values()].filter((bot) => room.memberIds.includes(bot.id)),
      );
      const messageId = nextId('msg');
      const linked = linkAttachments(roomId, input.attachmentIds, messageId);
      record(roomId, {
        ...base(roomId),
        type: 'message.completed',
        message: {
          id: messageId,
          threadId: roomId,
          role: 'user',
          content: input.content,
          createdAt: now(),
          ...(mentions.length > 0 ? { mentions } : {}),
          ...(linked.length > 0 ? { attachments: linked } : {}),
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
      record(roomId, { ...base(roomId), type: 'room.members', botIds: [...next] });
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
      record(created.threadId, { ...base(created.threadId), type: 'task.created', task: created });
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

    async listRoutines(botId?: string) {
      return [...routines.values()]
        .filter((routine) => botId === undefined || routine.botId === botId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
        .map((routine) => structuredClone(routine));
    },

    async createRoutine(input) {
      const data = CreateRoutine.parse(input);
      if (!bots.has(data.botId)) throw new Error(`Unknown bot: ${data.botId}`);
      const at = now();
      const created: Routine = {
        id: nextId('routine'),
        botId: data.botId,
        name: data.name,
        instruction: data.instruction,
        trigger: data.trigger,
        enabled: data.enabled,
        catchUp: data.catchUp,
        rememberLastRun: data.rememberLastRun,
        createdAt: at,
        updatedAt: at,
      };
      const nextRunAt = data.enabled && data.trigger.type === 'cron' ? nextMockRunAt(data.trigger.cron) : undefined;
      if (nextRunAt !== undefined) created.nextRunAt = nextRunAt;
      routines.set(created.id, created);
      routineRuns.set(created.id, []);
      return structuredClone(created);
    },

    async updateRoutine(routineId, patch) {
      const current = routines.get(routineId);
      if (!current) throw new Error(`Unknown routine: ${routineId}`);
      const data = UpdateRoutine.parse(patch);
      const next: Routine = {
        ...current,
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.instruction === undefined ? {} : { instruction: data.instruction }),
        ...(data.trigger === undefined ? {} : { trigger: data.trigger }),
        ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
        ...(data.catchUp === undefined ? {} : { catchUp: data.catchUp }),
        ...(data.rememberLastRun === undefined ? {} : { rememberLastRun: data.rememberLastRun }),
        updatedAt: now(),
      };
      const nextRunAt = next.enabled && next.trigger.type === 'cron' ? nextMockRunAt(next.trigger.cron) : undefined;
      if (nextRunAt === undefined) delete next.nextRunAt;
      else next.nextRunAt = nextRunAt;
      routines.set(routineId, next);
      return structuredClone(next);
    },

    async deleteRoutine(routineId) {
      if (!routines.delete(routineId)) throw new Error(`Unknown routine: ${routineId}`);
      routineRuns.delete(routineId);
      runningRoutines.delete(routineId);
    },

    async runRoutineNow(routineId) {
      const routine = routines.get(routineId);
      if (!routine) throw new Error('404 Routine not found');
      if (runningRoutines.has(routineId)) throw new Error('409 Routine is already running');
      runningRoutines.add(routineId);
      const startedAt = now();
      const runId = nextId('run');
      const started: RoutineRun = {
        id: nextId('rr'),
        routineId,
        botId: routine.botId,
        threadId: routineThreadOf(routine.botId),
        runId,
        trigger: 'manual',
        status: 'running',
        startedAt,
        createdAt: startedAt,
      };
      routineRuns.set(routineId, [started, ...(routineRuns.get(routineId) ?? [])]);
      // Finish on the next tick: a second request in the same moment still hits the overlap guard.
      setTimeout(() => {
        const endedAt = now();
        const completed: RoutineRun = {
          ...started,
          status: 'completed',
          result: `Ran ${routine.name} on demand. The routine finished its instruction and reported back in its thread.`,
          endedAt,
        };
        routineRuns.set(routineId, (routineRuns.get(routineId) ?? []).map((run) => (run.id === started.id ? completed : run)));
        const current = routines.get(routineId);
        if (current) {
          const next: Routine = { ...current, lastRunAt: endedAt, updatedAt: endedAt };
          const nextRunAt = current.enabled && current.trigger.type === 'cron' ? nextMockRunAt(current.trigger.cron, Date.parse(endedAt)) : undefined;
          if (nextRunAt === undefined) delete next.nextRunAt;
          else next.nextRunAt = nextRunAt;
          routines.set(routineId, next);
        }
        runningRoutines.delete(routineId);
      }, 0);
      return { runId };
    },

    async listRoutineRuns(filter: { routineId?: string; botId?: string; status?: RoutineRunStatus; limit?: number } = {}) {
      const matching = scheduledRuns().filter(
        (run) =>
          (filter.routineId === undefined || run.routineId === filter.routineId) &&
          (filter.botId === undefined || run.botId === filter.botId) &&
          (filter.status === undefined || run.status === filter.status),
      );
      return matching.slice(0, filter.limit ?? 50).map((run) => structuredClone(run));
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
      if (info.state === 'stopped' || info.state === 'error') void boot(botId, ensureDefaultThread(botId).id);
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
      const threadId = ensureDefaultThread(botId).id;
      const previous = screens.get(botId)?.takeover;
      return setTakeoverState(botId, threadId, {
        active: input.active,
        ...(input.reason ? { reason: input.reason } : previous?.reason && !input.active ? { reason: previous.reason } : {}),
        requestedBy: input.active ? 'user' : (previous?.requestedBy ?? 'user'),
      });
    },

    async browserStatus(botId) {
      hostBrowserOf(botId);
      return { state: browserStates.get(botId) ?? 'stopped' };
    },

    async startBrowserLogin(botId) {
      loginBotOf(botId);
      browserStates.set(botId, 'login');
      return { state: 'login' };
    },

    async closeBrowser(botId) {
      hostBrowserOf(botId);
      browserStates.set(botId, 'stopped');
    },
  };
}
