import { describe, expect, it } from 'vitest';
import {
  CreateBot,
  CreateRoom,
  CreateRoutine,
  CreateTask,
  PairingComplete,
  PostMessage,
  ResolveApproval,
  UpdateBot,
  UpdateRoomMembers,
  UpdateTask,
} from './requests';
import { MAX_ROOM_BOTS, MIN_ROOM_BOTS } from './constants';

describe('request schemas', () => {
  it('applies CreateBot defaults', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' })).toEqual({
      name: 'Ada',
      job: 'Researcher',
      instructions: '',
      engine: 'mock',
      computer: 'sandbox',
      egress: { mode: 'deny', allow: [] },
    });
  });

  it('gives each parsed CreateBot its own egress object', () => {
    const first = CreateBot.parse({ name: 'Ada', job: 'Researcher' });
    const second = CreateBot.parse({ name: 'Grace', job: 'Researcher' });
    first.egress.allow.push('example.com');
    expect(second.egress.allow).toEqual([]);
  });

  it('requires hostAcknowledged for computer host on CreateBot', () => {
    const base = { name: 'Ada', job: 'Researcher', computer: 'host' };
    expect(() => CreateBot.parse(base)).toThrow(/hostAcknowledged/);
    expect(() => CreateBot.parse({ ...base, hostAcknowledged: false })).toThrow(/hostAcknowledged/);
    expect(CreateBot.parse({ ...base, hostAcknowledged: true }).computer).toBe('host');
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', computer: 'none' }).computer).toBe('none');
  });

  it('validates egress on CreateBot', () => {
    expect(() =>
      CreateBot.parse({ name: 'Ada', job: 'x', egress: { mode: 'allowlist', allow: ['https://github.com'] } }),
    ).toThrow();
    expect(
      CreateBot.parse({ name: 'Ada', job: 'x', egress: { mode: 'allowlist', allow: ['*.github.com'] } }).egress,
    ).toEqual({ mode: 'allowlist', allow: ['*.github.com'] });
  });

  it('requires hostAcknowledged for computer host on UpdateBot only when computer is set', () => {
    expect(() => UpdateBot.parse({ computer: 'host' })).toThrow(/hostAcknowledged/);
    expect(UpdateBot.parse({ computer: 'host', hostAcknowledged: true })).toEqual({
      computer: 'host',
      hostAcknowledged: true,
    });
    expect(UpdateBot.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(UpdateBot.parse({ egress: { mode: 'deny', allow: [] } })).toEqual({ egress: { mode: 'deny', allow: [] } });
    expect(() => UpdateBot.parse({ egress: { mode: 'deny', allow: ['example.com'] } })).toThrow();
  });

  it('requires name and job on CreateBot', () => {
    expect(() => CreateBot.parse({ job: 'Researcher' })).toThrow();
    expect(() => CreateBot.parse({ name: 'Ada', job: '' })).toThrow();
  });

  it('keeps UpdateBot fields optional', () => {
    expect(UpdateBot.parse({ pinned: true })).toEqual({ pinned: true });
    expect(() => UpdateBot.parse({ computer: 'cloud' })).toThrow();
  });

  it('requires non-empty message content', () => {
    expect(PostMessage.parse({ content: 'hi' })).toEqual({ content: 'hi' });
    expect(() => PostMessage.parse({ content: '' })).toThrow();
  });

  it('validates approval decisions', () => {
    expect(ResolveApproval.parse({ decision: 'allow_always' })).toEqual({ decision: 'allow_always' });
    expect(() => ResolveApproval.parse({ decision: 'maybe' })).toThrow();
  });

  it('defaults routine enabled to true and pairing role to full', () => {
    const routine = CreateRoutine.parse({
      botId: 'bot_1',
      name: 'Daily',
      instruction: 'Summarize',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    });
    expect(routine.enabled).toBe(true);

    const pairing = PairingComplete.parse({ token: 't', deviceName: 'Phone', publicKey: 'pk' });
    expect(pairing.role).toBe('full');
  });
});

describe('room, membership, and task requests', () => {
  const botIds = (count: number) => Array.from({ length: count }, (_, i) => `bot_${i + 1}`);

  it('applies CreateRoom defaults and keeps the lead bot in the room', () => {
    expect(CreateRoom.parse({ title: 'Launch', botIds: ['bot_1', 'bot_2'], leadBotId: 'bot_1' })).toEqual({
      title: 'Launch',
      botIds: ['bot_1', 'bot_2'],
      leadBotId: 'bot_1',
      responder: 'lead',
    });
    expect(CreateRoom.parse({ title: 'Launch', botIds: ['bot_1', 'bot_2'], leadBotId: 'bot_2', responder: 'mention' }).responder).toBe(
      'mention',
    );
    expect(() => CreateRoom.parse({ title: 'Launch', botIds: ['bot_1', 'bot_2'], leadBotId: 'bot_3' })).toThrow(/lead bot/);
  });

  it(`accepts ${MIN_ROOM_BOTS} to ${MAX_ROOM_BOTS} bots and nothing else`, () => {
    const room = (count: number) => ({ title: 'Team', botIds: botIds(count), leadBotId: 'bot_1' });
    expect(CreateRoom.parse(room(MIN_ROOM_BOTS)).botIds).toHaveLength(MIN_ROOM_BOTS);
    expect(CreateRoom.parse(room(MAX_ROOM_BOTS)).botIds).toHaveLength(MAX_ROOM_BOTS);
    expect(() => CreateRoom.parse(room(MIN_ROOM_BOTS - 1))).toThrow();
    expect(() => CreateRoom.parse(room(MAX_ROOM_BOTS + 1))).toThrow();
  });

  it('rejects a room that names a bot twice or has no title', () => {
    expect(() => CreateRoom.parse({ title: 'Team', botIds: ['bot_1', 'bot_1'], leadBotId: 'bot_1' })).toThrow(/only once/);
    expect(() => CreateRoom.parse({ botIds: ['bot_1', 'bot_2'], leadBotId: 'bot_1' })).toThrow();
    expect(() => CreateRoom.parse({ title: 'Team', botIds: ['bot_1', 'bot_2'], leadBotId: 'bot_1', responder: 'auto' })).toThrow();
  });

  it('accepts membership changes and rejects empty, overlapping, or repeated ones', () => {
    expect(UpdateRoomMembers.parse({ add: ['bot_3'] })).toEqual({ add: ['bot_3'] });
    expect(UpdateRoomMembers.parse({ remove: ['bot_2'] })).toEqual({ remove: ['bot_2'] });
    expect(() => UpdateRoomMembers.parse({})).toThrow(/at least one bot/);
    expect(() => UpdateRoomMembers.parse({ add: [] })).toThrow(/at least one bot/);
    expect(() => UpdateRoomMembers.parse({ add: ['bot_3'], remove: ['bot_3'] })).toThrow(/added and removed/);
    expect(() => UpdateRoomMembers.parse({ add: ['bot_3', 'bot_3'] })).toThrow(/only once/);
  });

  it('creates a user root task without a creator, and a delegated task under a parent', () => {
    const root = CreateTask.parse({ title: 'Ship it', assigneeBotId: 'bot_2', threadId: 't1' });
    expect(root.createdByBotId).toBeUndefined();

    const child = CreateTask.parse({
      title: 'Draft copy',
      assigneeBotId: 'bot_2',
      threadId: 't1',
      createdByBotId: 'bot_1',
      parentTaskId: 'task_1',
    });
    expect(child).toMatchObject({ createdByBotId: 'bot_1', parentTaskId: 'task_1' });
  });

  it('rejects a user-created task with a parent, a bot delegating to itself, and a missing assignee', () => {
    expect(() => CreateTask.parse({ title: 'x', assigneeBotId: 'bot_2', threadId: 't1', parentTaskId: 'task_1' })).toThrow(
      /chain root/,
    );
    expect(() =>
      CreateTask.parse({ title: 'x', assigneeBotId: 'bot_1', threadId: 't1', createdByBotId: 'bot_1' }),
    ).toThrow(/itself/);
    expect(() => CreateTask.parse({ title: 'x', threadId: 't1' })).toThrow();
  });

  it('requires at least one field on UpdateTask', () => {
    expect(UpdateTask.parse({ status: 'done', result: 'Posted' })).toEqual({ status: 'done', result: 'Posted' });
    expect(UpdateTask.parse({ workThreadId: 'thr_bot_2' })).toEqual({ workThreadId: 'thr_bot_2' });
    expect(() => UpdateTask.parse({})).toThrow(/at least one field/);
    expect(() => UpdateTask.parse({ status: 'paused' })).toThrow();
  });

  it('accepts a team budget on CreateBot and lets UpdateBot clear it with null', () => {
    expect(CreateBot.parse({ name: 'Onça', job: 'Lead', teamBudgetUsd: 3 }).teamBudgetUsd).toBe(3);
    expect(UpdateBot.parse({ teamBudgetUsd: null })).toEqual({ teamBudgetUsd: null });
    expect(() => UpdateBot.parse({ teamBudgetUsd: -0.01 })).toThrow();
    expect(() => CreateBot.parse({ name: 'Onça', job: 'Lead', teamBudgetUsd: -1 })).toThrow();
  });
});
