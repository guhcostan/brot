import type { Approval, Bot, CanonicalEvent } from '@brot/protocol';

const CREATED = '2026-10-01T09:00:00.000Z';

function bot(
  id: string,
  name: string,
  job: string,
  avatar: string,
  computer: Bot['computer'],
  pinned: boolean,
): Bot {
  return {
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

/** One bot per fauna animal in DESIGN.md section 2. The avatar field holds the FaunaKind. */
export const DEMO_BOTS: Bot[] = [
  bot('bot_capy', 'Capy', 'Chief of Staff', 'capybara', 'sandbox', true),
  bot('bot_onca', 'Onça', 'Bug Fixer', 'jaguar', 'sandbox', false),
  bot('bot_tuca', 'Tuca', 'Sales follow-up', 'toucan', 'none', true),
  bot('bot_ara', 'Ara', 'Social and content', 'macaw', 'none', false),
  bot('bot_tamu', 'Tamu', 'Researcher', 'anteater', 'sandbox', false),
  bot('bot_boto', 'Boto', 'Web navigator', 'boto', 'sandbox', false),
  bot('bot_sol', 'Sol', 'Scheduled routines', 'sloth', 'none', false),
  bot('bot_mico', 'Mico', 'Quick tasks and triage', 'marmoset', 'none', false),
];

const capyThread = 'thread_bot_capy';
const tucaThread = 'thread_bot_tuca';

const pendingSend: Approval = {
  id: 'appr_seed_1',
  runId: 'run_tuca_seed',
  threadId: tucaThread,
  botId: 'bot_tuca',
  kind: 'send',
  tool: 'gmail.send',
  summary: 'Send "Pricing follow-up" to ana@acme.com',
  args: { to: 'ana@acme.com', subject: 'Pricing follow-up', body: 'Hi Ana, following up on the plans we discussed.' },
  status: 'pending',
  createdAt: '2026-10-19T08:40:00.000Z',
};

/** Seed history per bot. Only two bots have anything in them, so the empty states show too. */
export const DEMO_HISTORY: Record<string, CanonicalEvent[]> = {
  bot_capy: [
    {
      id: 'seed_c1',
      at: '2026-10-19T08:02:00.000Z',
      threadId: capyThread,
      type: 'message.completed',
      message: {
        id: 'seed_c_msg1',
        threadId: capyThread,
        role: 'user',
        content: "Morning. What's on today?",
        createdAt: '2026-10-19T08:02:00.000Z',
      },
    },
    {
      id: 'seed_c2',
      at: '2026-10-19T08:02:01.000Z',
      threadId: capyThread,
      runId: 'run_capy_1',
      type: 'run.started',
      botId: 'bot_capy',
      engine: 'mock',
    },
    {
      id: 'seed_c3',
      at: '2026-10-19T08:02:02.000Z',
      threadId: capyThread,
      runId: 'run_capy_1',
      type: 'tool.call',
      callId: 'call_calendar_1',
      tool: 'calendar.list_events',
      args: { date: '2026-10-19' },
    },
    {
      id: 'seed_c4',
      at: '2026-10-19T08:02:03.000Z',
      threadId: capyThread,
      runId: 'run_capy_1',
      type: 'tool.result',
      callId: 'call_calendar_1',
      ok: true,
      output: '09:30  Standup\n11:00  Design review\n15:00  Acme renewal call',
    },
    {
      id: 'seed_c5',
      at: '2026-10-19T08:02:04.000Z',
      threadId: capyThread,
      runId: 'run_capy_1',
      type: 'memory.written',
      memory: {
        id: 'mem_capy_1',
        botId: 'bot_capy',
        kind: 'preference',
        content: 'Short summaries before 10am.',
        sourceRunId: 'run_capy_1',
        createdAt: '2026-10-19T08:02:04.000Z',
        updatedAt: '2026-10-19T08:02:04.000Z',
      },
    },
    {
      id: 'seed_c6',
      at: '2026-10-19T08:02:05.000Z',
      threadId: capyThread,
      runId: 'run_capy_1',
      type: 'message.completed',
      message: {
        id: 'seed_c_msg2',
        threadId: capyThread,
        role: 'assistant',
        content:
          'Three things today: standup at 09:30, the design review at 11:00, and the Acme renewal call at 15:00. Want me to draft notes for the renewal?',
        createdAt: '2026-10-19T08:02:05.000Z',
      },
    },
    {
      id: 'seed_c7',
      at: '2026-10-19T08:02:06.000Z',
      threadId: capyThread,
      runId: 'run_capy_1',
      type: 'cost.updated',
      tokensIn: 812,
      tokensOut: 96,
      costUsd: 0.0031,
    },
    { id: 'seed_c8', at: '2026-10-19T08:02:06.000Z', threadId: capyThread, runId: 'run_capy_1', type: 'run.completed' },
  ],
  bot_tuca: [
    {
      id: 'seed_t1',
      at: '2026-10-19T08:39:00.000Z',
      threadId: tucaThread,
      type: 'message.completed',
      message: {
        id: 'seed_t_msg1',
        threadId: tucaThread,
        role: 'user',
        content: 'Send Ana the pricing follow-up from yesterday.',
        createdAt: '2026-10-19T08:39:00.000Z',
      },
    },
    {
      id: 'seed_t2',
      at: '2026-10-19T08:40:00.000Z',
      threadId: tucaThread,
      runId: 'run_tuca_seed',
      type: 'approval.requested',
      approval: pendingSend,
    },
  ],
};
