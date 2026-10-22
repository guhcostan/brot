import { afterEach, describe, expect, it } from 'vitest';
import type { Bot, Thread } from '@brot/protocol';
import { createApp } from '../app';
import type { Harness } from '../harness';
import { call, recordEvents, type TestContext } from '../testing';
import { addBot, closeContexts, createDm, json, listMessages, openContext, recordingEngine, until } from './fixtures';

afterEach(closeContexts);

async function makeRoom(ctx: TestContext, bots: Bot[], title = 'Team room'): Promise<Thread> {
  const lead = bots[0];
  if (lead === undefined) throw new Error('a room needs at least one bot');
  const response = await call(ctx.app, 'POST', '/api/rooms', {
    title,
    botIds: bots.map((bot) => bot.id),
    leadBotId: lead.id,
  });
  expect(response.status).toBe(201);
  return json<Thread>(response);
}

describe('DELETE /api/rooms/:id', () => {
  it('deletes a room with its members and messages, leaves other threads alone, and is gone on repeat', async () => {
    const ctx = await openContext(recordingEngine());
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const room = await makeRoom(ctx, [capy, dex]);
    await ctx.services.repos.messages.create({ threadId: room.id, role: 'user', content: 'hello room' });
    await ctx.services.repos.messages.create({
      threadId: room.id,
      role: 'assistant',
      content: 'hi from Capy',
      authorBotId: capy.id,
    });
    const dm = await createDm(ctx, capy.id);
    await ctx.services.repos.messages.create({ threadId: dm.id, role: 'user', content: 'dm stays' });

    const events = recordEvents(ctx.services.bus);
    const deleted = await call(ctx.app, 'DELETE', `/api/rooms/${room.id}`);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe('');
    // Deletion publishes no event; the web refreshes its room list.
    expect(events.list).toEqual([]);
    events.stop();

    expect(await ctx.services.repos.threads.get(room.id)).toBeUndefined();
    expect(await ctx.services.repos.messages.listByThread(room.id)).toEqual([]);
    expect(await ctx.services.repos.rooms.listMembers(room.id)).toEqual([]);
    expect((await json<Thread[]>(await call(ctx.app, 'GET', '/api/rooms'))).map((thread) => thread.id)).not.toContain(
      room.id,
    );

    expect((await ctx.services.repos.threads.get(dm.id))?.title).toBe(dm.title);
    expect((await listMessages(ctx, dm.id)).map((message) => message.content)).toEqual(['dm stays']);

    expect((await call(ctx.app, 'DELETE', `/api/rooms/${room.id}`)).status).toBe(404);
    expect((await call(ctx.app, 'DELETE', `/api/rooms/${dm.id}`)).status).toBe(404);
    expect((await call(ctx.app, 'DELETE', '/api/rooms/unknown')).status).toBe(404);
  });

  it('cascades tasks requested in the room and clears work-thread links to it', async () => {
    const ctx = await openContext(recordingEngine());
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const room = await makeRoom(ctx, [capy, dex]);
    const dm = await createDm(ctx, dex.id);
    const inRoom = await ctx.services.repos.tasks.create({
      title: 'Room task',
      assigneeBotId: capy.id,
      threadId: room.id,
    });
    const elsewhere = await ctx.services.repos.tasks.create({
      title: 'Other task',
      assigneeBotId: dex.id,
      threadId: dm.id,
    });
    await ctx.services.repos.tasks.update(elsewhere.id, { workThreadId: room.id });

    expect((await call(ctx.app, 'DELETE', `/api/rooms/${room.id}`)).status).toBe(204);

    expect(await ctx.services.repos.tasks.get(inRoom.id)).toBeUndefined();
    const survivor = await ctx.services.repos.tasks.get(elsewhere.id);
    expect(survivor).toMatchObject({ title: 'Other task', threadId: dm.id });
    expect(survivor?.workThreadId).toBeUndefined();
  });

  it('cancels the room’s active runs through the harness before deleting it', async () => {
    const ctx = await openContext(recordingEngine());
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const room = await makeRoom(ctx, [capy, dex]);
    const active = await ctx.services.repos.runs.create({ threadId: room.id, botId: capy.id, engine: 'mock' });
    const finished = await ctx.services.repos.runs.create({ threadId: room.id, botId: dex.id, engine: 'mock' });
    await ctx.services.repos.runs.update(finished.id, { status: 'completed', endedAt: new Date().toISOString() });

    const cancelled: string[] = [];
    const unused = (): Promise<never> => Promise.reject(new Error('the fake harness does not support this call'));
    const harness: Harness = {
      startRun: unused,
      startBotRun: unused,
      cancelRun: async (runId) => {
        cancelled.push(runId);
        return undefined;
      },
      cancelBotRuns: async () => undefined,
      recoverInterruptedRuns: unused,
      resetEngineSessions: unused,
      shutdown: () => undefined,
    };
    const app = createApp({
      ...ctx.services,
      harness,
      config: { host: '127.0.0.1', port: 8799, mode: 'server' },
      trustLoopback: true,
    });

    const response = await call(app, 'DELETE', `/api/rooms/${room.id}`);
    expect(response.status).toBe(204);
    expect(cancelled).toEqual([active.id]);
    expect(await ctx.services.repos.threads.get(room.id)).toBeUndefined();
  });

  it('stops an in-flight room run before the thread disappears', async () => {
    const recording = recordingEngine({ holdUntilCancelled: true });
    const ctx = await openContext(recording);
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const room = await makeRoom(ctx, [capy, dex]);
    const events = recordEvents(ctx.services.bus);

    const posted = await call(ctx.app, 'POST', `/api/threads/${room.id}/messages`, { content: 'stay open' });
    expect(posted.status).toBe(202);
    const { runId } = await json<{ runId: string | null }>(posted);
    if (runId === null) throw new Error('the room must start a run for its lead bot');
    await until(() => recording.runs.length === 1);

    expect((await call(ctx.app, 'DELETE', `/api/rooms/${room.id}`)).status).toBe(204);
    expect(events.list.some((event) => event.type === 'run.failed' && event.runId === runId)).toBe(true);
    expect(await ctx.services.repos.threads.get(room.id)).toBeUndefined();
    events.stop();
  });
});

describe('PATCH /api/threads/:id on a room', () => {
  it('still renames a room', async () => {
    const ctx = await openContext(recordingEngine());
    const capy = await addBot(ctx, 'Capy');
    const dex = await addBot(ctx, 'Dex');
    const room = await makeRoom(ctx, [capy, dex]);

    const renamed = await call(ctx.app, 'PATCH', `/api/threads/${room.id}`, { title: 'Renamed room' });
    expect(renamed.status).toBe(200);
    expect(await json<Thread>(renamed)).toMatchObject({ id: room.id, kind: 'room', title: 'Renamed room' });
    const rooms = await json<Thread[]>(await call(ctx.app, 'GET', '/api/rooms'));
    expect(rooms.find((thread) => thread.id === room.id)?.title).toBe('Renamed room');
  });
});
