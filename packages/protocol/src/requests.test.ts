import { describe, expect, it } from 'vitest';
import {
  BrowserStatus,
  CreateBot,
  CreateBrowserProfile,
  CreateMemory,
  CreateRoom,
  CreateSavedLogin,
  CreateTeam,
  CreateThread,
  CreateWorkspaceMemory,
  CreateRoutine,
  CreateTask,
  PairingComplete,
  PostMessage,
  ResolveApproval,
  SetBrowserTakeover,
  UpdateBot,
  UpdateBrowserProfile,
  UpdateRoomMembers,
  UpdateRoutine,
  UpdateSavedLogin,
  UpdateTask,
  UpdateTeam,
  UpdateThread,
} from './requests';
import { MAX_ROOM_BOTS, MIN_ROOM_BOTS } from './constants';
import { ATTACHMENT_MAX_PER_MESSAGE } from './attachments';

describe('request schemas', () => {
  it('applies CreateBot defaults', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' })).toEqual({
      name: 'Ada',
      job: 'Researcher',
      instructions: '',
      engine: 'mock',
      computer: 'sandbox',
      browser: false,
      notifications: true,
      speakReplies: false,
      approvalMode: 'ask',
      egress: { mode: 'deny', allow: [] },
    });
  });

  it('accepts an ordered fallback chain on a bot and rejects more than 3, duplicates or bad refs', () => {
    expect(
      CreateBot.parse({ name: 'Ada', job: 'Researcher', fallbackModels: ['deepseek/deepseek-flash'] }).fallbackModels,
    ).toEqual(['deepseek/deepseek-flash']);
    expect(
      CreateBot.parse({
        name: 'Ada',
        job: 'Researcher',
        fallbackModels: ['deepseek/deepseek-flash', 'opencode-go/deepseek-v4.1-flash'],
      }).fallbackModels,
    ).toHaveLength(2);
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' }).fallbackModels).toBeUndefined();
    expect(UpdateBot.parse({ fallbackModels: null })).toEqual({ fallbackModels: null });
    expect(UpdateBot.parse({ fallbackModels: [] })).toEqual({ fallbackModels: [] });

    const three = ['a/b', 'c/d', 'e/f'];
    expect(() =>
      CreateBot.parse({ name: 'Ada', job: 'Researcher', fallbackModels: [...three, 'g/h'] }),
    ).toThrow();
    expect(() => CreateBot.parse({ name: 'Ada', job: 'Researcher', fallbackModels: ['a/b', 'a/b'] })).toThrow(/unique/);
    expect(() => CreateBot.parse({ name: 'Ada', job: 'Researcher', fallbackModels: ['no-slash'] })).toThrow();
    expect(() => UpdateBot.parse({ fallbackModels: ['provider/'] })).toThrow();
  });

  it('defaults the bot approval mode to ask and accepts edits', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' }).approvalMode).toBe('ask');
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', approvalMode: 'edits' }).approvalMode).toBe('edits');
    expect(UpdateBot.parse({ approvalMode: 'edits' })).toEqual({ approvalMode: 'edits' });
    expect(UpdateBot.parse({ approvalMode: 'ask' })).toEqual({ approvalMode: 'ask' });
    expect(() => CreateBot.parse({ name: 'Ada', job: 'Researcher', approvalMode: 'always' })).toThrow();
    expect(() => UpdateBot.parse({ approvalMode: 'auto' })).toThrow();
  });

  it('validates a host browser status and the profile behind it', () => {
    const own = { state: 'login', profile: { kind: 'own' } };
    expect(BrowserStatus.parse(own)).toEqual(own);
    const shared = { state: 'running', profile: { kind: 'shared', id: 'bp_1', name: 'Shared accounts' } };
    expect(BrowserStatus.parse(shared)).toEqual(shared);
    expect(() => BrowserStatus.parse({ state: 'opening', profile: { kind: 'own' } })).toThrow();
    expect(() => BrowserStatus.parse({ state: 'login' })).toThrow();
    expect(() => BrowserStatus.parse({ state: 'login', profile: { kind: 'team' } })).toThrow();
  });

  it('validates a saved login, keeping values out of the API but checking their shape', () => {
    const input = {
      name: '  GitHub work  ',
      host: 'GitHub.COM',
      username: 'ada@example.com',
      password: 'correct horse battery staple',
      totp: 'jbswy3dp ehpk3pxp',
    };
    const parsed = CreateSavedLogin.parse(input);
    expect(parsed.name).toBe('GitHub work');
    expect(parsed.host).toBe('github.com');
    expect(parsed.totp).toBe('jbswy3dp ehpk3pxp');
    expect(() => CreateSavedLogin.parse({ ...input, host: 'https://github.com' })).toThrow();
    expect(() => CreateSavedLogin.parse({ ...input, host: 'github.com/login' })).toThrow();
    expect(() => CreateSavedLogin.parse({ ...input, host: 'github.com:443' })).toThrow();
    expect(() => CreateSavedLogin.parse({ ...input, name: 'two\nlines' })).toThrow();
    expect(() => CreateSavedLogin.parse({ ...input, totp: 'not base32!' })).toThrow();
    expect(() => CreateSavedLogin.parse({ ...input, password: '' })).toThrow();
    expect(UpdateSavedLogin.parse({ totp: null })).toEqual({ totp: null });
    expect(UpdateSavedLogin.parse({ host: 'Example.ORG' })).toEqual({ host: 'example.org' });
  });

  it('validates a browser takeover request', () => {
    expect(SetBrowserTakeover.parse({ active: true, reason: 'Sign in' })).toEqual({ active: true, reason: 'Sign in' });
    expect(SetBrowserTakeover.parse({ active: false })).toEqual({ active: false });
    expect(() => SetBrowserTakeover.parse({ active: 'yes' })).toThrow();
    expect(() => SetBrowserTakeover.parse({ active: true, reason: 'x'.repeat(501) })).toThrow();
  });

  it('accepts a browser flag on CreateBot and UpdateBot', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', browser: true }).browser).toBe(true);
    expect(UpdateBot.parse({ browser: true })).toEqual({ browser: true });
    expect(UpdateBot.parse({ browser: false })).toEqual({ browser: false });
  });

  it('accepts a shared browser profile on CreateBot and clears it on UpdateBot', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', browserProfileId: 'bp_1' }).browserProfileId).toBe('bp_1');
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' }).browserProfileId).toBeUndefined();
    expect(UpdateBot.parse({ browserProfileId: 'bp_1' })).toEqual({ browserProfileId: 'bp_1' });
    expect(UpdateBot.parse({ browserProfileId: null })).toEqual({ browserProfileId: null });
  });

  it('trims and validates a browser profile name', () => {
    expect(CreateBrowserProfile.parse({ name: '  Shared accounts  ' })).toEqual({ name: 'Shared accounts' });
    expect(UpdateBrowserProfile.parse({ name: 'Work' })).toEqual({ name: 'Work' });
    expect(() => CreateBrowserProfile.parse({ name: '   ' })).toThrow();
    expect(() => CreateBrowserProfile.parse({ name: 'x'.repeat(61) })).toThrow();
    expect(() => CreateBrowserProfile.parse({ name: 'two\nlines' })).toThrow(/single line/);
  });

  it('leaves the MCP server grant absent by default and accepts an allowlist or null', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' })).not.toHaveProperty('mcpServerIds');
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', mcpServerIds: ['mcp_1'] }).mcpServerIds).toEqual(['mcp_1']);
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', mcpServerIds: [] }).mcpServerIds).toEqual([]);
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', mcpServerIds: null }).mcpServerIds).toBeNull();
    expect(UpdateBot.parse({ mcpServerIds: ['mcp_1'] })).toEqual({ mcpServerIds: ['mcp_1'] });
    expect(UpdateBot.parse({ mcpServerIds: null })).toEqual({ mcpServerIds: null });
    expect(UpdateBot.parse({ mcpServerIds: [] })).toEqual({ mcpServerIds: [] });
    expect(() =>
      UpdateBot.parse({ mcpServerIds: Array.from({ length: 51 }, (_, i) => `mcp_${i}`) }),
    ).toThrow();
    expect(() => UpdateBot.parse({ mcpServerIds: [''] })).toThrow();
  });

  it('defaults spoken replies off and lets CreateBot or UpdateBot turn them on', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' }).speakReplies).toBe(false);
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', speakReplies: true }).speakReplies).toBe(true);
    expect(UpdateBot.parse({ speakReplies: true })).toEqual({ speakReplies: true });
  });

  it('defaults the notification toggle on and lets UpdateBot turn it off', () => {
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher' }).notifications).toBe(true);
    expect(CreateBot.parse({ name: 'Ada', job: 'Researcher', notifications: false }).notifications).toBe(false);
    expect(UpdateBot.parse({ notifications: false })).toEqual({ notifications: false });
    expect(UpdateBot.parse({ notifications: true })).toEqual({ notifications: true });
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

  it('accepts unique mentions of up to a room of bots', () => {
    expect(PostMessage.parse({ content: '@Capy look', mentions: ['bot_1', 'bot_2'] })).toEqual({
      content: '@Capy look',
      mentions: ['bot_1', 'bot_2'],
    });
    const full = Array.from({ length: MAX_ROOM_BOTS }, (_, i) => `bot_${i}`);
    expect(PostMessage.parse({ content: 'all', mentions: full }).mentions).toHaveLength(MAX_ROOM_BOTS);
    expect(() => PostMessage.parse({ content: 'x', mentions: ['bot_1', 'bot_1'] })).toThrow(/only once/);
    expect(() => PostMessage.parse({ content: 'x', mentions: [...full, 'bot_extra'] })).toThrow();
    expect(() => PostMessage.parse({ content: 'x', mentions: [''] })).toThrow();
  });

  it('accepts up to ten attachment ids on a message', () => {
    expect(PostMessage.parse({ content: 'See this', attachmentIds: ['att_1', 'att_2'] })).toEqual({
      content: 'See this',
      attachmentIds: ['att_1', 'att_2'],
    });
    const full = Array.from({ length: ATTACHMENT_MAX_PER_MESSAGE }, (_, i) => `att_${i}`);
    expect(PostMessage.parse({ content: 'all', attachmentIds: full }).attachmentIds).toHaveLength(ATTACHMENT_MAX_PER_MESSAGE);
    expect(() => PostMessage.parse({ content: 'x', attachmentIds: [...full, 'att_extra'] })).toThrow();
    expect(() => PostMessage.parse({ content: 'x', attachmentIds: [''] })).toThrow();
    expect(() => PostMessage.parse({ content: 'x', attachmentIds: [1] })).toThrow();
  });

  it('creates memories for a bot or for the whole workspace', () => {
    expect(CreateMemory.parse({ kind: 'fact', content: 'Likes tea' })).toEqual({ kind: 'fact', content: 'Likes tea' });
    expect(CreateWorkspaceMemory.parse({ kind: 'preference', content: 'Works in Lisbon' })).toEqual({
      kind: 'preference',
      content: 'Works in Lisbon',
    });
    expect(() => CreateWorkspaceMemory.parse({ kind: 'fact', content: 'x', botId: 'bot_1' })).toThrow();
    expect(() => CreateWorkspaceMemory.parse({ kind: 'other', content: 'x' })).toThrow();
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

  it('defaults routine catch-up on and remember-last-run off, and accepts a timezone', () => {
    const base = {
      botId: 'bot_1',
      name: 'Daily',
      instruction: 'Summarize',
      trigger: { type: 'cron', cron: '0 9 * * *' },
    };
    expect(CreateRoutine.parse(base)).toMatchObject({ catchUp: true, rememberLastRun: false });
    expect(CreateRoutine.parse({ ...base, catchUp: false, rememberLastRun: true })).toMatchObject({
      catchUp: false,
      rememberLastRun: true,
    });
    const localized = CreateRoutine.parse({
      ...base,
      trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'Europe/Lisbon' },
    });
    expect(localized.trigger).toEqual({ type: 'cron', cron: '0 9 * * *', timezone: 'Europe/Lisbon' });
    expect(() => CreateRoutine.parse({ ...base, trigger: { type: 'cron', cron: '0 9 * * *', timezone: '' } })).toThrow();
    expect(UpdateRoutine.parse({ catchUp: false, rememberLastRun: true })).toEqual({ catchUp: false, rememberLastRun: true });
    expect(() => UpdateRoutine.parse({ catchUp: 'yes' })).toThrow();
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
    expect(UpdateTask.parse({ workRunId: 'run_1', status: 'cancelled' })).toEqual({
      workRunId: 'run_1',
      status: 'cancelled',
    });
    expect(() => UpdateTask.parse({ workRunId: '' })).toThrow();
    expect(() => UpdateTask.parse({})).toThrow(/at least one field/);
    expect(() => UpdateTask.parse({ status: 'paused' })).toThrow();
  });

  it('accepts a team id on CreateBot and lets UpdateBot clear it with null', () => {
    expect(CreateBot.parse({ name: 'Onça', job: 'Lead', teamId: 'team_1' }).teamId).toBe('team_1');
    expect(CreateBot.parse({ name: 'Onça', job: 'Lead' }).teamId).toBeUndefined();
    expect(UpdateBot.parse({ teamId: null })).toEqual({ teamId: null });
    expect(UpdateBot.parse({ teamId: 'team_2' })).toEqual({ teamId: 'team_2' });
    expect(() => UpdateBot.parse({ teamId: '' })).toThrow();
  });

  it('defaults a new team to an empty brief and validates its fields', () => {
    expect(CreateTeam.parse({ name: 'Growth' })).toEqual({ name: 'Growth', instructions: '' });
    expect(CreateTeam.parse({ name: 'Growth', instructions: 'Ship weekly.', chiefBotId: 'bot_1' })).toEqual({
      name: 'Growth',
      instructions: 'Ship weekly.',
      chiefBotId: 'bot_1',
    });
    expect(() => CreateTeam.parse({ name: '' })).toThrow();
    expect(() => CreateTeam.parse({ name: 'Growth', chiefBotId: '' })).toThrow();
  });

  it('keeps UpdateTeam fields optional and lets it clear the chief with null', () => {
    expect(UpdateTeam.parse({ chiefBotId: null })).toEqual({ chiefBotId: null });
    expect(UpdateTeam.parse({ name: 'Ops', instructions: '' })).toEqual({ name: 'Ops', instructions: '' });
    expect(UpdateTeam.parse({})).toEqual({});
    expect(() => UpdateTeam.parse({ name: '' })).toThrow();
  });

  it('accepts a thread model reference and lets an update clear it', () => {
    expect(CreateThread.parse({ model: 'opencode-go/deepseek-v4.1-flash' }).model).toBe(
      'opencode-go/deepseek-v4.1-flash',
    );
    expect(CreateThread.parse({ model: 'openrouter/anthropic/claude-x' }).model).toBe(
      'openrouter/anthropic/claude-x',
    );
    expect(() => CreateThread.parse({ model: 'no-slash' })).toThrow(/provider/);
    expect(() => CreateThread.parse({ model: '/model' })).toThrow();
    expect(() => CreateThread.parse({ model: 'provider/' })).toThrow();

    expect(UpdateThread.parse({ model: null })).toEqual({ model: null });
    expect(UpdateThread.parse({ model: 'deepseek/deepseek-flash' })).toEqual({ model: 'deepseek/deepseek-flash' });
    expect(UpdateThread.parse({ title: 'Plan', model: 'fake/model-2' })).toEqual({
      title: 'Plan',
      model: 'fake/model-2',
    });
    expect(() => UpdateThread.parse({ model: 'broken' })).toThrow();
    expect(() => UpdateThread.parse({})).toThrow(/at least one field/);
  });

  it('requires a thread title of 1 to 120 characters to rename one', () => {
    expect(UpdateThread.parse({ title: 'Planning' })).toEqual({ title: 'Planning' });
    expect(() => UpdateThread.parse({ title: '' })).toThrow();
    expect(() => UpdateThread.parse({ title: 'x'.repeat(121) })).toThrow();
    expect(UpdateThread.parse({ title: 'x'.repeat(120) }).title).toHaveLength(120);
  });

  it('accepts a team budget on CreateBot and lets UpdateBot clear it with null', () => {
    expect(CreateBot.parse({ name: 'Onça', job: 'Lead', teamBudgetUsd: 3 }).teamBudgetUsd).toBe(3);
    expect(UpdateBot.parse({ teamBudgetUsd: null })).toEqual({ teamBudgetUsd: null });
    expect(() => UpdateBot.parse({ teamBudgetUsd: -0.01 })).toThrow();
    expect(() => CreateBot.parse({ name: 'Onça', job: 'Lead', teamBudgetUsd: -1 })).toThrow();
  });
});
