import { describe, expect, it } from 'vitest';
import { TEAM_MAX_DEPTH } from './constants';
import {
  Approval,
  Bot,
  Computer,
  Device,
  Memory,
  Message,
  Policy,
  ResponderMode,
  RoomMember,
  Routine,
  Run,
  Skill,
  Task,
  TaskStatus,
  Thread,
  ThreadKind,
} from './entities';

const at = '2026-10-19T12:00:00.000Z';

const bot = {
  id: 'bot_1',
  name: 'Ada',
  job: 'Research assistant',
  instructions: 'Be precise.',
  avatar: 'ada.png',
  engine: 'mock',
  model: 'mock-1',
  computer: 'sandbox' as const,
  pinned: true,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

describe('entity schemas', () => {
  it('round-trips a bot through JSON', () => {
    expect(roundTrip(Bot, bot)).toEqual(bot);
  });

  it('round-trips thread, message, and run', () => {
    const thread = { id: 't1', botId: 'bot_1', title: 'Hello', createdAt: at, updatedAt: at };
    const message = { id: 'm1', threadId: 't1', role: 'assistant', content: 'Hi', createdAt: at };
    const run = {
      id: 'r1',
      threadId: 't1',
      botId: 'bot_1',
      status: 'completed',
      engine: 'mock',
      startedAt: at,
      endedAt: at,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.001,
    };
    expect(roundTrip(Thread, thread)).toEqual(thread);
    expect(roundTrip(Message, message)).toEqual(message);
    expect(roundTrip(Run, run)).toEqual(run);
  });

  it('round-trips approval, policy, memory, and skill', () => {
    const approval = {
      id: 'a1',
      runId: 'r1',
      threadId: 't1',
      botId: 'bot_1',
      kind: 'shell',
      tool: 'bash',
      summary: 'ls -la',
      args: { command: 'ls -la' },
      status: 'pending',
      createdAt: at,
    };
    const policy = { id: 'p1', botId: 'bot_1', tool: 'bash', argPattern: 'ls *', effect: 'allow', createdAt: at };
    const memory = { id: 'mem1', botId: 'bot_1', kind: 'fact', content: 'Likes tea', createdAt: at, updatedAt: at };
    const skill = {
      id: 's1',
      name: 'summarize',
      description: 'Summarize text',
      body: '# Summarize',
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    expect(roundTrip(Approval, approval)).toEqual(approval);
    expect(roundTrip(Policy, policy)).toEqual(policy);
    expect(roundTrip(Memory, memory)).toEqual(memory);
    expect(roundTrip(Skill, skill)).toEqual(skill);
  });

  it('round-trips routines with both trigger kinds and device', () => {
    const cron = {
      id: 'rt1',
      botId: 'bot_1',
      name: 'Daily',
      instruction: 'Summarize news',
      trigger: { type: 'cron', cron: '0 9 * * *' },
      enabled: true,
      createdAt: at,
      updatedAt: at,
    };
    const webhook = { ...cron, id: 'rt2', trigger: { type: 'webhook', secret: 's3cret' } };
    const device = { id: 'd1', name: 'Phone', role: 'approver', publicKey: 'pk', createdAt: at };
    expect(roundTrip(Routine, cron)).toEqual(cron);
    expect(roundTrip(Routine, webhook)).toEqual(webhook);
    expect(roundTrip(Device, device)).toEqual(device);
  });

  it('round-trips a bot with an egress policy and a thread with an engine session', () => {
    const withEgress = { ...bot, egress: { mode: 'allowlist', allow: ['api.github.com', '*.example.com'] } };
    expect(roundTrip(Bot, withEgress)).toEqual(withEgress);

    const thread = { id: 't1', botId: 'bot_1', title: 'Hello', engineSessionId: 'sess_9', createdAt: at, updatedAt: at };
    expect(roundTrip(Thread, thread)).toEqual(thread);
  });

  it('round-trips a computer and rejects unknown states', () => {
    const computer = {
      id: 'cmp_1',
      botId: 'bot_1',
      state: 'ready',
      image: 'ghcr.io/brot/computer:0.1.0',
      createdAt: at,
      updatedAt: at,
    };
    expect(roundTrip(Computer, computer)).toEqual(computer);
    expect(roundTrip(Computer, { ...computer, state: 'error', error: 'pull failed' })).toMatchObject({
      state: 'error',
      error: 'pull failed',
    });
    expect(() => Computer.parse({ ...computer, state: 'running' })).toThrow();
    expect(() => Computer.parse({ ...computer, image: '' })).toThrow();
  });

  it('rejects invalid enum values and timestamps', () => {
    expect(() => Bot.parse({ ...bot, computer: 'cloud' })).toThrow();
    expect(() => Bot.parse({ ...bot, createdAt: 'yesterday' })).toThrow();
    expect(() => Run.parse({ ...bot, status: 'paused' })).toThrow();
    expect(() => Routine.parse({ ...bot, trigger: { type: 'interval' } })).toThrow();
  });
});

describe('rooms, messages, and team tasks', () => {
  const task = {
    id: 'task_1',
    title: 'Draft the launch post',
    status: 'open' as const,
    assigneeBotId: 'bot_2',
    createdByUser: true,
    threadId: 't1',
    chainId: 'task_1',
    depth: 0,
    createdAt: at,
    updatedAt: at,
  };

  it('reads a thread row written before rooms existed as a DM', () => {
    const parsed = Thread.parse({ id: 't1', botId: 'bot_1', title: 'Chat', createdAt: at, updatedAt: at });
    expect(parsed.kind).toBeUndefined();
    expect(parsed.responder).toBeUndefined();
  });

  it('round-trips a room thread with its lead bot and responder', () => {
    const room = {
      id: 't2',
      botId: 'bot_1',
      title: 'Launch room',
      kind: 'room',
      leadBotId: 'bot_1',
      responder: 'mention',
      createdAt: at,
      updatedAt: at,
    };
    expect(roundTrip(Thread, room)).toEqual(room);
    expect(ThreadKind.options).toEqual(['dm', 'room']);
    expect(ResponderMode.options).toEqual(['mention', 'lead']);
  });

  it('rejects an unknown thread kind or responder mode', () => {
    expect(() => Thread.parse({ id: 't', botId: 'b', title: 'x', kind: 'group', createdAt: at, updatedAt: at })).toThrow();
    expect(() =>
      Thread.parse({ id: 't', botId: 'b', title: 'x', responder: 'auto', createdAt: at, updatedAt: at }),
    ).toThrow();
  });

  it('round-trips room membership', () => {
    const member = { threadId: 't2', botId: 'bot_2', joinedAt: at };
    expect(roundTrip(RoomMember, member)).toEqual(member);
    expect(() => RoomMember.parse({ threadId: 't2', botId: 'bot_2' })).toThrow();
  });

  it('round-trips the author, mentions, and recipient of a message', () => {
    const message = {
      id: 'm2',
      threadId: 't2',
      role: 'assistant',
      content: 'Over to you',
      createdAt: at,
      authorBotId: 'bot_1',
      mentions: ['bot_2'],
      viaBotId: 'bot_2',
    };
    expect(roundTrip(Message, message)).toEqual(message);
    expect(() => Message.parse({ ...message, mentions: 'bot_2' })).toThrow();
  });

  it('accepts a bot with a team budget and rejects a negative one', () => {
    const budgeted = {
      id: 'bot_1',
      name: 'Onça',
      job: 'Lead',
      instructions: '',
      engine: 'dsh',
      computer: 'none',
      pinned: false,
      archived: false,
      teamBudgetUsd: 2.5,
      createdAt: at,
      updatedAt: at,
    };
    expect(roundTrip(Bot, budgeted)).toEqual(budgeted);
    expect(() => Bot.parse({ ...budgeted, teamBudgetUsd: -1 })).toThrow();
  });

  it('accepts every task status and nothing else', () => {
    for (const status of ['open', 'in_progress', 'blocked', 'done', 'failed', 'cancelled']) {
      expect(TaskStatus.parse(status)).toBe(status);
    }
    expect(() => TaskStatus.parse('paused')).toThrow();
  });

  it('round-trips a user-created root task', () => {
    expect(roundTrip(Task, task)).toEqual(task);
  });

  it('round-trips a delegated task under its parent', () => {
    const child = {
      ...task,
      id: 'task_2',
      createdByUser: false,
      createdByBotId: 'bot_1',
      parentTaskId: 'task_1',
      workThreadId: 'thr_bot_2',
      result: 'Posted',
      status: 'done' as const,
      chainId: 'task_1',
      depth: 1,
    };
    expect(roundTrip(Task, child)).toEqual(child);
  });

  it('round-trips the run doing a task, and leaves it absent until work starts', () => {
    expect(task).not.toHaveProperty('workRunId');
    const working = { ...task, status: 'in_progress' as const, workRunId: 'run_1' };
    expect(roundTrip(Task, working)).toEqual(working);
  });

  it('accepts a delegated task at the deepest allowed level', () => {
    expect(Task.parse({ ...task, id: 'task_9', createdByUser: false, createdByBotId: 'bot_1', chainId: 'task_1', depth: TEAM_MAX_DEPTH }).depth).toBe(TEAM_MAX_DEPTH);
  });

  it('rejects a task deeper than the chain limit', () => {
    expect(() =>
      Task.parse({ ...task, id: 'task_9', createdByUser: false, createdByBotId: 'bot_1', chainId: 'task_1', depth: TEAM_MAX_DEPTH + 1 }),
    ).toThrow();
  });

  it('rejects a user-created task that is not depth 0, names a creator, has a parent, or breaks its chain', () => {
    expect(() => Task.parse({ ...task, depth: 1 })).toThrow(/depth 0/);
    expect(() => Task.parse({ ...task, createdByBotId: 'bot_1' })).toThrow(/creator/);
    expect(() => Task.parse({ ...task, parentTaskId: 'task_0' })).toThrow(/chain root/);
    expect(() => Task.parse({ ...task, chainId: 'other' })).toThrow(/own id/);
  });

  it('rejects a delegated task at depth 0', () => {
    expect(() => Task.parse({ ...task, createdByUser: false, createdByBotId: 'bot_1', chainId: 'task_1', depth: 0 })).toThrow(
      /depth 1 or more/,
    );
  });

  it('keeps a delegated task whose creator bot was deleted', () => {
    const orphan = { ...task, id: 'task_3', createdByUser: false, chainId: 'task_1', depth: 1 };
    expect(roundTrip(Task, orphan)).toEqual(orphan);
  });
});
