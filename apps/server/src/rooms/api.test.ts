import type { Bot, CanonicalEvent, RoomMember, Thread } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { call, recordEvents } from '../testing';
import {
  addBot,
  closeContexts,
  createDm,
  json,
  listMessages,
  openContext,
  recordingEngine,
  until,
  type Recording,
} from './fixtures';
import type { TestContext } from '../testing';

afterEach(closeContexts);

interface Team {
  ctx: TestContext;
  recording: Recording;
  capy: Bot;
  dex: Bot;
  ivy: Bot;
}

async function team(): Promise<Team> {
  const recording = recordingEngine();
  const ctx = await openContext(recording);
  return {
    ctx,
    recording,
    capy: await addBot(ctx, 'Capy'),
    dex: await addBot(ctx, 'Dex'),
    ivy: await addBot(ctx, 'Ivy'),
  };
}

function makeRoom(
  ctx: TestContext,
  body: { leadBotId: string; botIds: string[]; responder?: 'lead' | 'mention' },
): Promise<Response> {
  return call(ctx.app, 'POST', '/api/rooms', { title: 'Team', ...body });
}

async function createRoom(
  ctx: TestContext,
  body: { leadBotId: string; botIds: string[]; responder?: 'lead' | 'mention' },
): Promise<Thread> {
  const response = await makeRoom(ctx, body);
  expect(response.status).toBe(201);
  return json<Thread>(response);
}

async function post(ctx: TestContext, threadId: string, content: string): Promise<{ runId: string | null }> {
  const response = await call(ctx.app, 'POST', `/api/threads/${threadId}/messages`, { content });
  expect(response.status).toBe(202);
  return json<{ runId: string | null }>(response);
}

function endedRuns(events: CanonicalEvent[]): number {
  return events.filter((event) => event.type === 'run.completed' || event.type === 'run.failed').length;
}

describe('rooms API', () => {
  it('rejects a room whose lead bot is not one of its members', async () => {
    const { ctx, capy, dex, ivy } = await team();
    const response = await makeRoom(ctx, { leadBotId: ivy.id, botIds: [capy.id, dex.id] });
    expect(response.status).toBe(400);
    const unknown = await makeRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, 'nobody'] });
    expect(unknown.status).toBe(400);
  });

  it('creates a room, lists its members, and emits room.members', async () => {
    const { ctx, capy, dex } = await team();
    const events = recordEvents(ctx.services.bus);
    const room = await createRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, dex.id] });
    expect(room).toMatchObject({ kind: 'room', botId: capy.id, leadBotId: capy.id, responder: 'lead' });

    const members = await json<RoomMember[]>(await call(ctx.app, 'GET', `/api/rooms/${room.id}/members`));
    expect(members.map((member) => member.botId).sort()).toEqual([capy.id, dex.id].sort());
    expect(events.list.some((event) => event.type === 'room.members' && event.threadId === room.id)).toBe(true);

    expect((await json<Thread[]>(await call(ctx.app, 'GET', '/api/rooms'))).map((item) => item.id)).toEqual([room.id]);
    const memberRooms = await json<Thread[]>(await call(ctx.app, 'GET', `/api/bots/${dex.id}/threads?kind=room`));
    expect(memberRooms.map((item) => item.id)).toEqual([room.id]);
    const dms = await json<Thread[]>(await call(ctx.app, 'GET', `/api/bots/${dex.id}/threads?kind=dm`));
    expect(dms).toEqual([]);
  });

  it('validates member changes: unknown bots, the lead, and the size range', async () => {
    const { ctx, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, dex.id] });
    const path = `/api/rooms/${room.id}/members`;

    expect((await call(ctx.app, 'PATCH', path, { add: ['nobody'] })).status).toBe(400);
    expect((await call(ctx.app, 'PATCH', path, { remove: [capy.id] })).status).toBe(409);
    expect((await call(ctx.app, 'PATCH', path, { remove: [dex.id] })).status).toBe(409);

    const added = await call(ctx.app, 'PATCH', path, { add: [ivy.id] });
    expect(added.status).toBe(200);
    expect((await json<RoomMember[]>(added)).map((member) => member.botId).sort()).toEqual(
      [capy.id, dex.id, ivy.id].sort(),
    );
    expect((await call(ctx.app, 'PATCH', path, { remove: [dex.id, ivy.id] })).status).toBe(409);
    expect((await call(ctx.app, 'GET', '/api/rooms/missing/members')).status).toBe(404);
  });

  it('routes @mentions to member bots, ignoring case and non-members, and stores them on the message', async () => {
    const { ctx, recording, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, {
      leadBotId: capy.id,
      botIds: [capy.id, dex.id, ivy.id],
      responder: 'mention',
    });
    const events = recordEvents(ctx.services.bus, room.id);

    const result = await post(ctx, room.id, 'hey @DEX, what do you think? @ghost too');
    expect(result.runId).toEqual(expect.any(String));
    await until(() => endedRuns(events.list) === 1);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Dex']);

    const userMessage = (await listMessages(ctx, room.id)).find((message) => message.role === 'user');
    expect(userMessage?.mentions).toEqual([dex.id]);
  });

  it('refuses mentions that name a bot twice, or an empty id, before any run starts', async () => {
    const { ctx, recording, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, {
      leadBotId: capy.id,
      botIds: [capy.id, dex.id, ivy.id],
      responder: 'mention',
    });

    for (const mentions of [[dex.id, dex.id], ['']]) {
      const response = await call(ctx.app, 'POST', `/api/threads/${room.id}/messages`, { content: 'hey', mentions });
      expect(response.status).toBe(400);
    }
    expect(recording.runs).toHaveLength(0);
  });

  it('lets the lead bot answer unmentioned messages, and mentions take over from it', async () => {
    const { ctx, recording, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, dex.id, ivy.id] });
    const events = recordEvents(ctx.services.bus, room.id);

    await post(ctx, room.id, 'anyone there?');
    await until(() => endedRuns(events.list) === 1);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Capy']);

    await post(ctx, room.id, '@Ivy then @Dex, go');
    await until(() => endedRuns(events.list) === 3);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Capy', 'Ivy', 'Dex']);
  });

  it('stays silent in mention mode when nobody is mentioned', async () => {
    const { ctx, recording, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, dex.id, ivy.id], responder: 'mention' });

    const result = await post(ctx, room.id, 'everyone, status?');
    expect(result.runId).toBeNull();
    expect(recording.runs).toEqual([]);
    expect(await ctx.services.repos.runs.listByThread(room.id)).toEqual([]);
  });

  it('runs mentioned bots one after another, so each sees the earlier replies with author labels', async () => {
    const { ctx, recording, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, dex.id, ivy.id], responder: 'mention' });
    const events = recordEvents(ctx.services.bus, room.id);

    await post(ctx, room.id, '@Capy @Dex weigh in');
    await until(() => endedRuns(events.list) === 2);

    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Capy', 'Dex']);
    expect(recording.runs[0]?.input).toBe('[User]: @Capy @Dex weigh in');
    expect(recording.runs[1]?.history.map((message) => message.content)).toContain(
      '[Capy]: Capy replies to: [User]: @Capy @Dex weigh in',
    );

    const assistants = (await listMessages(ctx, room.id)).filter((message) => message.role === 'assistant');
    expect(assistants.map((message) => message.authorBotId)).toEqual([capy.id, dex.id]);
  });

  it('gives each bot its own engine session and resumes it with the messages it missed', async () => {
    const { ctx, recording, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, dex.id, ivy.id], responder: 'mention' });
    const events = recordEvents(ctx.services.bus, room.id);

    await post(ctx, room.id, '@Capy @Dex hi');
    await until(() => endedRuns(events.list) === 2);
    const repos = ctx.services.repos;
    expect(await repos.threadSessions.get(room.id, capy.id)).toBe(`session:Capy:${room.id}`);
    expect(await repos.threadSessions.get(room.id, dex.id)).toBe(`session:Dex:${room.id}`);
    expect((await repos.threads.get(room.id))?.engineSessionId).toBeUndefined();

    await post(ctx, room.id, '@Capy again');
    await until(() => endedRuns(events.list) === 3);
    const resumed = recording.runs[2];
    expect(resumed?.bot.name).toBe('Capy');
    expect(resumed?.engineSessionId).toBe(`session:Capy:${room.id}`);
    expect(resumed?.input).toBe('[Dex]: Dex replies to: [User]: @Capy @Dex hi\n[User]: @Capy again');
  });

  it('keeps a DM session on the thread, not in thread_sessions', async () => {
    const { ctx, capy } = await team();
    const dm = await createDm(ctx, capy.id);
    const events = recordEvents(ctx.services.bus, dm.id);
    await call(ctx.app, 'POST', `/api/threads/${dm.id}/messages`, { content: 'hello' });
    await until(() => endedRuns(events.list) === 1);
    expect((await ctx.services.repos.threads.get(dm.id))?.engineSessionId).toBe(`session:Capy:${dm.id}`);
    expect(await ctx.services.repos.threadSessions.get(dm.id, capy.id)).toBeUndefined();
  });

  it('replays the event log after a given event, oldest first', async () => {
    const { ctx, capy } = await team();
    const dm = await createDm(ctx, capy.id);
    const events = recordEvents(ctx.services.bus, dm.id);
    await call(ctx.app, 'POST', `/api/threads/${dm.id}/messages`, { content: 'one' });
    await until(() => endedRuns(events.list) === 1);

    const log = await json<CanonicalEvent[]>(await call(ctx.app, 'GET', `/api/threads/${dm.id}/events`));
    expect(log.length).toBeGreaterThanOrEqual(4);
    const sorted = log.map((event) => event.at).every((at, index, all) => index === 0 || all[index - 1]! <= at);
    expect(sorted).toBe(true);

    const after = log[1]!.id;
    const rest = await json<CanonicalEvent[]>(await call(ctx.app, 'GET', `/api/threads/${dm.id}/events?after=${after}`));
    expect(rest.map((event) => event.id)).toEqual(log.slice(2).map((event) => event.id));

    expect((await call(ctx.app, 'GET', `/api/threads/${dm.id}/events?after=missing`)).status).toBe(404);
    expect((await call(ctx.app, 'GET', '/api/threads/missing/events')).status).toBe(404);
  });

  it('a baton makes the target answer the next unmentioned message, and only that one', async () => {
    const { ctx, recording, capy, dex, ivy } = await team();
    const room = await createRoom(ctx, { leadBotId: capy.id, botIds: [capy.id, dex.id, ivy.id] });
    const events = recordEvents(ctx.services.bus, room.id);
    const rooms = ctx.services.rooms;

    await rooms.setBaton(room.id, ivy.id);
    await post(ctx, room.id, 'next question');
    await until(() => endedRuns(events.list) === 1);
    await post(ctx, room.id, 'another question');
    await until(() => endedRuns(events.list) === 2);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Ivy', 'Capy']);

    await expect(rooms.setBaton(room.id, 'nobody')).rejects.toThrow(/member/);
  });
});
