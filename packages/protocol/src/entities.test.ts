import { describe, expect, it } from 'vitest';
import { Approval, Bot, Computer, Device, Memory, Message, Policy, Routine, Run, Skill, Thread } from './entities';

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
