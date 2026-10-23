import { afterEach, describe, expect, it } from 'vitest';
import type { Bot, CanonicalEvent, Thread } from '@brot/protocol';
import { call, recordEvents, type TestContext } from '../testing';
import { addBot, closeContexts, json, openContext, recordingEngine, until } from './fixtures';
import { createRoomService } from './service';

afterEach(closeContexts);

async function makeRoom(ctx: TestContext, bots: Bot[]): Promise<Thread> {
  const lead = bots[0];
  if (lead === undefined) throw new Error('a room needs bots');
  const response = await call(ctx.app, 'POST', '/api/rooms', {
    title: 'Team',
    botIds: bots.map((bot) => bot.id),
    leadBotId: lead.id,
  });
  expect(response.status).toBe(201);
  return json<Thread>(response);
}

function endedRuns(events: CanonicalEvent[]): number {
  return events.filter((event) => event.type === 'run.completed' || event.type === 'run.failed').length;
}

async function threadOf(ctx: TestContext, roomId: string): Promise<Thread> {
  const thread = await ctx.services.repos.threads.get(roomId);
  if (thread === undefined) throw new Error('the room thread disappeared');
  return thread;
}

describe('room baton persistence', () => {
  it('keeps the baton across a new service instance and consumes it on the next unmentioned message', async () => {
    const recording = recordingEngine();
    const ctx = await openContext(recording);
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const ivy = await addBot(ctx, 'Ivy');
    const room = await makeRoom(ctx, [capy, dex, ivy]);

    await ctx.services.rooms.setBaton(room.id, ivy.id);
    expect(await ctx.services.repos.roomBatons.get(room.id)).toBe(ivy.id);

    // A fresh service instance stands in for a server restart: nothing is carried in memory.
    const restarted = createRoomService({
      repos: ctx.services.repos,
      bus: ctx.services.bus,
      harness: () => ctx.services.harness,
    });
    const thread = await threadOf(ctx, room.id);
    const events = recordEvents(ctx.services.bus, room.id);

    await restarted.post(thread, { content: 'after the restart' });
    await until(() => endedRuns(events.list) === 1);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Ivy']);
    expect(await ctx.services.repos.roomBatons.get(room.id)).toBeUndefined();

    await restarted.post(thread, { content: 'and then' });
    await until(() => endedRuns(events.list) === 2);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Ivy', 'Capy']);
    events.stop();
  });

  it('lets a mention keep the baton and a handoff overwrite it', async () => {
    const recording = recordingEngine();
    const ctx = await openContext(recording);
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const ivy = await addBot(ctx, 'Ivy');
    const room = await makeRoom(ctx, [capy, dex, ivy]);
    const thread = await threadOf(ctx, room.id);
    const events = recordEvents(ctx.services.bus, room.id);

    await ctx.services.rooms.setBaton(room.id, ivy.id);
    await ctx.services.rooms.post(thread, { content: '@Dex can you look?' });
    await until(() => endedRuns(events.list) === 1);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Dex']);
    expect(await ctx.services.repos.roomBatons.get(room.id)).toBe(ivy.id);

    await ctx.services.rooms.setBaton(room.id, dex.id);
    expect(await ctx.services.repos.roomBatons.get(room.id)).toBe(dex.id);
    await ctx.services.rooms.post(thread, { content: 'next question' });
    await until(() => endedRuns(events.list) === 2);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Dex', 'Dex']);
    expect(await ctx.services.repos.roomBatons.get(room.id)).toBeUndefined();
    events.stop();
  });

  it('ignores and clears a baton whose holder left the room, answering with the lead', async () => {
    const recording = recordingEngine();
    const ctx = await openContext(recording);
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const ivy = await addBot(ctx, 'Ivy');
    const room = await makeRoom(ctx, [capy, dex, ivy]);
    await ctx.services.rooms.setBaton(room.id, ivy.id);

    const removed = await call(ctx.app, 'PATCH', `/api/rooms/${room.id}/members`, { remove: [ivy.id] });
    expect(removed.status).toBe(200);

    const thread = await threadOf(ctx, room.id);
    const events = recordEvents(ctx.services.bus, room.id);
    await ctx.services.rooms.post(thread, { content: 'hello without Ivy' });
    await until(() => endedRuns(events.list) === 1);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Capy']);
    expect(await ctx.services.repos.roomBatons.get(room.id)).toBeUndefined();
    events.stop();
  });
});
