import type { Approval, Bot, CanonicalEvent, Message, Task, Thread } from '@brot/protocol';

const CREATED = '2026-10-01T09:00:00.000Z';

function bot(
  id: string,
  name: string,
  job: string,
  avatar: string,
  computer: Bot['computer'],
  pinned: boolean,
  extra: Partial<Bot> = {},
): Bot {
  return {
    ...extra,
    id,
    name,
    job,
    instructions: '',
    avatar,
    engine: 'mock',
    model: 'mock-1',
    computer,
    pinned,
    archived: false,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

/** A demo team across the avatar species and colors in DESIGN.md section 2. */
export const DEMO_BOTS: Bot[] = [
  bot('bot_capy', 'Capy', 'Chief of Staff', 'capivara:black', 'sandbox', true),
  bot('bot_onca', 'Onça', 'Bug Fixer', 'onca:orange', 'sandbox', false),
  bot('bot_tuca', 'Tuca', 'Sales follow-up', 'tucano:amber', 'none', true),
  bot('bot_ara', 'Ara', 'Social and content', 'arara:pink', 'sandbox', false, {
    desktop: true,
    egress: { mode: 'allowlist', allow: ['linkedin.com', '*.linkedin.com'] },
  }),
  bot('bot_tamu', 'Tamu', 'Researcher', 'tamandua:teal', 'sandbox', false),
  bot('bot_boto', 'Boto', 'Web operator', 'boto:blue', 'sandbox', false, {
    desktop: true,
    egress: { mode: 'allowlist', allow: ['news.ycombinator.com', 'duckduckgo.com', 'github.com'] },
    teamBudgetUsd: 2,
  }),
  bot('bot_sol', 'Sol', 'Scheduled routines', 'preguica:violet', 'none', false),
  bot('bot_mico', 'Mico', 'Quick tasks and triage', 'mico:brown', 'none', false),
];

/** The DM thread id the mock uses for a bot. */
export const dmThreadOf = (botId: string) => `thread_${botId}`;

export const LAUNCH_ROOM = 'room_acme';
export const WEEK_ROOM = 'room_week';

const day = (time: string) => `2026-10-19T${time}.000Z`;

function room(id: string, title: string, leadBotId: string, responder: Thread['responder'], at: string): Thread {
  return { id, botId: leadBotId, title, kind: 'room', leadBotId, responder, createdAt: at, updatedAt: at };
}

export const DEMO_ROOMS: Array<{ thread: Thread; memberIds: string[] }> = [
  {
    thread: room(LAUNCH_ROOM, 'Acme renewal', 'bot_capy', 'lead', day('08:05:00')),
    memberIds: ['bot_capy', 'bot_onca', 'bot_tuca', 'bot_tamu'],
  },
  {
    thread: room(WEEK_ROOM, 'Launch week', 'bot_ara', 'mention', day('07:30:00')),
    memberIds: ['bot_ara', 'bot_boto', 'bot_sol'],
  },
];

type TaskSeed = Omit<Task, 'createdAt' | 'updatedAt' | 'chainId' | 'depth' | 'createdByUser'> & {
  at: string;
  updated?: string;
  chainId?: string;
  depth?: number;
};

function task(seed: TaskSeed): Task {
  const { at, updated, chainId, depth, ...rest } = seed;
  const createdByUser = rest.createdByBotId === undefined;
  return {
    ...rest,
    createdByUser,
    chainId: chainId ?? rest.id,
    depth: depth ?? (createdByUser ? 0 : 1),
    createdAt: at,
    updatedAt: updated ?? at,
  };
}

export const TASK_ROOT = 'task_acme';
export const TASK_EXPORT = 'task_export';
export const TASK_LIMIT = 'task_limit';
export const TASK_EMAIL = 'task_email';

export const DEMO_TASKS: Task[] = [
  task({
    id: TASK_ROOT,
    title: 'Get the Acme renewal ready by Friday',
    description: 'Fix the export bug Acme hit and send Ana a follow-up before the renewal call.',
    status: 'in_progress',
    assigneeBotId: 'bot_capy',
    threadId: LAUNCH_ROOM,
    workThreadId: dmThreadOf('bot_capy'),
    at: day('08:10:30'),
    updated: day('08:12:00'),
  }),
  task({
    id: TASK_EXPORT,
    title: 'Fix the CSV export timeout',
    description: 'Acme times out exporting about 40k rows to CSV.',
    status: 'in_progress',
    assigneeBotId: 'bot_onca',
    createdByBotId: 'bot_capy',
    parentTaskId: TASK_ROOT,
    chainId: TASK_ROOT,
    threadId: LAUNCH_ROOM,
    workThreadId: dmThreadOf('bot_onca'),
    at: day('08:11:40'),
    updated: day('08:32:00'),
  }),
  task({
    id: TASK_LIMIT,
    title: 'Check the export row limit in the docs',
    status: 'done',
    assigneeBotId: 'bot_tamu',
    createdByBotId: 'bot_onca',
    parentTaskId: TASK_EXPORT,
    chainId: TASK_ROOT,
    depth: 2,
    threadId: dmThreadOf('bot_onca'),
    workThreadId: dmThreadOf('bot_tamu'),
    result: 'Exports are capped at 25k rows per request. Larger files have to stream in pages (API guide, 4.2).',
    at: day('08:14:00'),
    updated: day('08:16:30'),
  }),
  task({
    id: TASK_EMAIL,
    title: 'Send Ana the renewal follow-up',
    description: 'Plans and pricing, plus the ETA for the export fix.',
    status: 'blocked',
    assigneeBotId: 'bot_tuca',
    createdByBotId: 'bot_capy',
    parentTaskId: TASK_ROOT,
    chainId: TASK_ROOT,
    threadId: LAUNCH_ROOM,
    workThreadId: dmThreadOf('bot_tuca'),
    result: 'Draft ready. Waiting for your OK to send.',
    at: day('08:11:45'),
    updated: day('08:40:00'),
  }),
  task({
    id: 'task_post',
    title: 'Post the release note on LinkedIn',
    status: 'failed',
    assigneeBotId: 'bot_ara',
    threadId: dmThreadOf('bot_ara'),
    workThreadId: dmThreadOf('bot_ara'),
    result: 'Stopped. The site asked for a sign-in.',
    at: day('07:40:00'),
    updated: day('07:42:10'),
  }),
  task({
    id: 'task_remind',
    title: "Remind the team about Friday's demo",
    status: 'open',
    assigneeBotId: 'bot_sol',
    createdByBotId: 'bot_capy',
    threadId: dmThreadOf('bot_capy'),
    at: day('08:03:00'),
  }),
  task({
    id: 'task_triage',
    title: 'Triage the support inbox',
    status: 'done',
    assigneeBotId: 'bot_mico',
    threadId: dmThreadOf('bot_mico'),
    workThreadId: dmThreadOf('bot_mico'),
    result: '12 sorted: 3 bugs to Onça, 9 answered from the help center.',
    at: day('07:15:00'),
    updated: day('07:21:00'),
  }),
];

const taskById = (id: string): Task => {
  const found = DEMO_TASKS.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown demo task ${id}`);
  return found;
};

/** Builds a thread's seed events with sequential ids. */
function script(threadId: string, prefix: string) {
  const events: CanonicalEvent[] = [];
  let n = 0;
  const base = (at: string, runId?: string) => ({ id: `${prefix}_${(n += 1)}`, at: day(at), threadId, runId });
  const message = (
    at: string,
    role: Message['role'],
    content: string,
    extra: Partial<Pick<Message, 'authorBotId' | 'mentions' | 'viaBotId'>> = {},
    runId?: string,
  ) => {
    const event = base(at, runId);
    events.push({
      ...event,
      type: 'message.completed',
      message: { id: `${event.id}_msg`, threadId, role, content, createdAt: day(at), ...extra },
    });
  };
  return {
    events,
    user: (at: string, content: string, mentions?: string[]) => message(at, 'user', content, mentions ? { mentions } : {}),
    say: (at: string, runId: string, botId: string, content: string) =>
      message(at, 'assistant', content, { authorBotId: botId }, runId),
    via: (at: string, from: string, to: string, content: string) =>
      message(at, 'user', content, { authorBotId: from, viaBotId: to }),
    start: (at: string, runId: string, botId: string) =>
      events.push({ ...base(at, runId), type: 'run.started', botId, engine: 'mock', model: 'mock-1' }),
    done: (at: string, runId: string, costUsd = 0.003) => {
      events.push({ ...base(at, runId), type: 'cost.updated', tokensIn: 900, tokensOut: 110, costUsd });
      events.push({ ...base(at, runId), type: 'run.completed' });
    },
    fail: (at: string, runId: string, error: string) => events.push({ ...base(at, runId), type: 'run.failed', error }),
    tool: (at: string, runId: string, callId: string, tool: string, args: Record<string, unknown>, ok: boolean, output: string) => {
      events.push({ ...base(at, runId), type: 'tool.call', callId, tool, args });
      events.push({ ...base(at, runId), type: 'tool.result', callId, ok, output });
    },
    taskCreated: (at: string, id: string) => events.push({ ...base(at), type: 'task.created', task: taskById(id) }),
    ask: (at: string, runId: string, askId: string, from: string, to: string, question: string) =>
      events.push({ ...base(at, runId), type: 'bot.asked', askId, fromBotId: from, toBotId: to, question }),
    answer: (at: string, runId: string, askId: string, from: string, to: string, answer: string) =>
      events.push({ ...base(at, runId), type: 'bot.answered', askId, fromBotId: from, toBotId: to, answer }),
    handoff: (at: string, runId: string, from: string, to: string, note: string) =>
      events.push({ ...base(at, runId), type: 'handoff', fromBotId: from, toBotId: to, note }),
    members: (at: string, botIds: string[]) => events.push({ ...base(at), type: 'room.members', botIds }),
    raw: (event: CanonicalEvent) => events.push(event),
  };
}

const tucaThread = dmThreadOf('bot_tuca');

export const PENDING_SEND: Approval = {
  id: 'appr_seed_1',
  runId: 'run_tuca_seed',
  threadId: tucaThread,
  botId: 'bot_tuca',
  kind: 'send',
  tool: 'gmail.send',
  summary: 'Send "Acme renewal: plans and export fix" to ana@acme.com',
  args: {
    to: 'ana@acme.com',
    subject: 'Acme renewal: plans and export fix',
    body: 'Hi Ana, here are the Business and Enterprise plans for the renewal. The export fix ships this week.',
  },
  status: 'pending',
  createdAt: day('08:40:00'),
};

/** The ask that stays open on load, so the room shows a live bot-to-bot exchange. */
export const OPEN_ASK = { askId: 'ask_rows', runId: 'run_room_3', from: 'bot_onca', to: 'bot_tamu' };

function capyDm(): CanonicalEvent[] {
  const s = script(dmThreadOf('bot_capy'), 'seed_c');
  s.user('08:02:00', "Morning. What's on today?");
  s.start('08:02:01', 'run_capy_1', 'bot_capy');
  s.tool('08:02:02', 'run_capy_1', 'call_calendar_1', 'calendar.list_events', { date: '2026-10-19' }, true, '09:30  Standup\n11:00  Design review\n15:00  Acme renewal call');
  s.raw({
    id: 'seed_c_mem',
    at: day('08:02:04'),
    threadId: dmThreadOf('bot_capy'),
    runId: 'run_capy_1',
    type: 'memory.written',
    memory: {
      id: 'mem_capy_1',
      botId: 'bot_capy',
      kind: 'preference',
      content: 'Short summaries before 10am.',
      sourceRunId: 'run_capy_1',
      createdAt: day('08:02:04'),
      updatedAt: day('08:02:04'),
    },
  });
  s.say('08:02:05', 'run_capy_1', 'bot_capy', 'Three things today: standup at 09:30, the design review at 11:00, and the Acme renewal call at 15:00. I asked Sol to remind the team about the demo.');
  s.taskCreated('08:03:00', 'task_remind');
  s.done('08:03:01', 'run_capy_1', 0.0031);
  return s.events;
}

function launchRoom(): CanonicalEvent[] {
  const s = script(LAUNCH_ROOM, 'seed_r');
  s.members('08:05:00', DEMO_ROOMS[0]!.memberIds);
  s.user('08:10:00', '@Capy Acme renews on Nov 1. Can the team fix the export bug they hit and get a follow-up to Ana by Friday?', ['bot_capy']);
  s.taskCreated('08:10:30', TASK_ROOT);
  s.start('08:10:31', 'run_room_1', 'bot_capy');
  s.say('08:10:40', 'run_room_1', 'bot_capy', 'On it. Onça takes the export bug and Tuca takes the follow-up. One question for Tamu first.');
  s.ask('08:10:42', 'run_room_1', 'ask_report', 'bot_capy', 'bot_tamu', 'What exactly did Acme report about the export, and which plan are they on?');
  s.answer('08:11:20', 'run_room_1', 'ask_report', 'bot_capy', 'bot_tamu', 'They hit a timeout exporting about 40k rows to CSV on Tuesday. They are on Business and renew on Nov 1.');
  s.say('08:11:30', 'run_room_1', 'bot_capy', 'Thanks, Tamu. Delegating now.');
  s.say('08:11:32', 'run_room_1', 'bot_capy', 'Onça: find the cause of the timeout and ship a fix today. Tuca: draft the follow-up to Ana with the plans and the fix ETA.');
  s.taskCreated('08:11:40', TASK_EXPORT);
  s.taskCreated('08:11:45', TASK_EMAIL);
  s.handoff('08:11:50', 'run_room_1', 'bot_capy', 'bot_tuca', 'Tuca owns the customer email from here.');
  s.done('08:11:51', 'run_room_1', 0.0042);
  s.start('08:12:00', 'run_room_2', 'bot_tuca');
  s.say('08:39:30', 'run_room_2', 'bot_tuca', 'The draft is ready in my thread. It needs your OK before it goes to Ana.');
  s.done('08:39:31', 'run_room_2', 0.0019);
  s.user('08:41:00', '@Onça how is the export fix going?', ['bot_onca']);
  s.start('08:41:01', OPEN_ASK.runId, 'bot_onca');
  s.say('08:41:20', OPEN_ASK.runId, 'bot_onca', 'Found it: the export loads every row before it writes. I am switching it to stream in pages.');
  s.ask('08:41:22', OPEN_ASK.runId, OPEN_ASK.askId, OPEN_ASK.from, OPEN_ASK.to, 'Is the 25k row cap per request or per file?');
  return s.events;
}

function weekRoom(): CanonicalEvent[] {
  const s = script(WEEK_ROOM, 'seed_w');
  s.members('07:30:00', DEMO_ROOMS[1]!.memberIds);
  s.user('07:31:00', '@Ara draft three short posts for launch week. @Sol schedule them for Mon, Wed, Fri at 9.', ['bot_ara', 'bot_sol']);
  s.start('07:31:01', 'run_week_1', 'bot_ara');
  s.say('07:31:30', 'run_week_1', 'bot_ara', 'Three drafts are in my thread: the launch, the team behind it, and a customer story. Each one is under 280 characters.');
  s.done('07:31:31', 'run_week_1');
  s.start('07:31:32', 'run_week_2', 'bot_sol');
  s.say('07:31:50', 'run_week_2', 'bot_sol', 'Scheduled for Monday, Wednesday and Friday at 09:00. I will post only after you approve each one.');
  s.done('07:31:51', 'run_week_2', 0.0008);
  return s.events;
}

function oncaDm(): CanonicalEvent[] {
  const s = script(dmThreadOf('bot_onca'), 'seed_o');
  s.via('08:11:41', 'bot_capy', 'bot_onca', 'Acme times out exporting about 40k rows to CSV. Find the cause and ship a fix today.');
  s.start('08:11:42', 'run_onca_1', 'bot_onca');
  s.tool('08:12:10', 'run_onca_1', 'call_grep_1', 'shell', { command: 'rg -n "exportCsv" src/' }, true, 'src/export/csv.ts:14:export async function exportCsv(rows) {\nsrc/export/csv.ts:15:  const all = await rows.toArray();');
  s.say('08:13:50', 'run_onca_1', 'bot_onca', 'exportCsv loads every row into memory before writing. Asking Tamu for the documented limit before I change it.');
  s.taskCreated('08:14:00', TASK_LIMIT);
  s.done('08:14:01', 'run_onca_1', 0.0052);
  return s.events;
}

function tamuDm(): CanonicalEvent[] {
  const s = script(dmThreadOf('bot_tamu'), 'seed_m');
  s.via('08:14:01', 'bot_onca', 'bot_tamu', 'What is the export row limit? Please check the API docs.');
  s.start('08:14:02', 'run_tamu_1', 'bot_tamu');
  s.tool('08:15:00', 'run_tamu_1', 'call_docs_1', 'docs.search', { query: 'export row limit' }, true, 'API guide 4.2: Exports return at most 25,000 rows per request. Use cursor pages for larger files.');
  s.say('08:16:30', 'run_tamu_1', 'bot_tamu', 'Exports are capped at 25k rows per request. Larger files have to stream in pages (API guide, 4.2).');
  s.done('08:16:31', 'run_tamu_1', 0.0011);
  return s.events;
}

function tucaDm(): CanonicalEvent[] {
  const s = script(tucaThread, 'seed_t');
  s.via('08:11:46', 'bot_capy', 'bot_tuca', 'Draft the renewal follow-up to Ana (ana@acme.com): the plans, plus the ETA for the export fix.');
  s.start('08:11:47', 'run_tuca_seed', 'bot_tuca');
  s.say('08:39:00', 'run_tuca_seed', 'bot_tuca', 'Here is the draft. I will send it as soon as you approve.');
  s.raw({ id: 'seed_t_appr', at: day('08:40:00'), threadId: tucaThread, runId: 'run_tuca_seed', type: 'approval.requested', approval: PENDING_SEND });
  return s.events;
}

function araDm(): CanonicalEvent[] {
  const s = script(dmThreadOf('bot_ara'), 'seed_a');
  s.user('07:40:00', 'Post the release note on LinkedIn.');
  s.taskCreated('07:40:00', 'task_post');
  s.start('07:40:01', 'run_ara_1', 'bot_ara');
  s.tool('07:41:00', 'run_ara_1', 'call_browser_1', 'browser.open', { url: 'https://www.linkedin.com/feed/' }, false, 'The page asked for a sign-in.');
  s.fail('07:42:10', 'run_ara_1', 'Stopped. The site asked for a sign-in. Sign in on the computer, then ask Ara again.');
  return s.events;
}

function botoDm(): CanonicalEvent[] {
  const thread = dmThreadOf('bot_boto');
  const s = script(thread, 'seed_b');
  s.user('08:20:00', 'What is on the front page of Hacker News right now?');
  s.start('08:20:01', 'run_boto_1', 'bot_boto');
  s.tool('08:20:03', 'run_boto_1', 'call_b1', 'browser_open', { url: 'https://news.ycombinator.com' }, true, '{"url":"https://news.ycombinator.com/","title":"Hacker News"}');
  s.tool('08:20:05', 'run_boto_1', 'call_b2', 'browser_snapshot', {}, true, 'Hacker News\n  link "new" [ref=3]\n  link "Show HN: A team of bots in a chat app" [ref=12]\n  link "SQLite in the browser, three years on" [ref=18]\n  link "The quiet craft of good defaults" [ref=24]');
  s.tool('08:20:08', 'run_boto_1', 'call_b3', 'browser_click', { ref: 12 }, true, '{"url":"https://news.ycombinator.com/item?id=4242","title":"Show HN: A team of bots in a chat app"}');
  s.say('08:20:12', 'run_boto_1', 'bot_boto', 'Top three right now: "Show HN: A team of bots in a chat app", "SQLite in the browser, three years on", and "The quiet craft of good defaults". I opened the first one on my screen if you want a look.');
  s.done('08:20:13', 'run_boto_1', 0.0024);
  s.raw({ id: 'seed_b_status', at: day('08:20:00'), threadId: thread, type: 'computer.status', computerId: 'cmp_boto', botId: 'bot_boto', state: 'ready' });
  return s.events;
}

/** Seed history per DM bot. Some bots have none, so the empty states show too. */
export const DEMO_HISTORY: Record<string, CanonicalEvent[]> = {
  bot_capy: capyDm(),
  bot_onca: oncaDm(),
  bot_tamu: tamuDm(),
  bot_tuca: tucaDm(),
  bot_ara: araDm(),
  bot_boto: botoDm(),
};

export const DEMO_ROOM_HISTORY: Record<string, CanonicalEvent[]> = {
  [LAUNCH_ROOM]: launchRoom(),
  [WEEK_ROOM]: weekRoom(),
};
