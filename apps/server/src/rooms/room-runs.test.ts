import { createEngineRegistry } from '@brot/engines';
import type { Thread } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createBrotMcp } from '../mcp';
import { createTeamTools } from '../team';
import { call, createTestContext, type TestContext } from '../testing';
import { addBot, closeContexts, json, listMessages, openContext, recordingEngine, until, type Recording } from './fixtures';

afterEach(closeContexts);

async function createRoom(ctx: TestContext, botIds: string[], leadBotId: string): Promise<Thread> {
  const response = await call(ctx.app, 'POST', '/api/rooms', { title: 'Launch', botIds, leadBotId, responder: 'mention' });
  expect(response.status).toBe(201);
  return json<Thread>(response);
}

async function post(ctx: TestContext, threadId: string, content: string): Promise<void> {
  const response = await call(ctx.app, 'POST', `/api/threads/${threadId}/messages`, { content });
  expect(response.status).toBe(202);
}

describe('room chain budget', () => {
  it('stops a room exchange once its default budget is spent, and says so in the room', async () => {
    const recording = recordingEngine({ costUsd: 0.6 });
    const ctx = await openContext(recording);
    const ana = await addBot(ctx, 'Ana');
    const bo = await addBot(ctx, 'Bo');
    const cy = await addBot(ctx, 'Cy');
    const room = await createRoom(ctx, [ana.id, bo.id, cy.id], ana.id);

    await post(ctx, room.id, '@Ana @Bo @Cy plan the launch');

    await until(async () => (await listMessages(ctx, room.id)).some((message) => message.role === 'system'));
    const notice = (await listMessages(ctx, room.id)).find((message) => message.role === 'system');
    expect(notice?.content).toMatch(/stopped before its next reply: the team budget for this chain is spent/);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Ana', 'Bo']);
  });

  it('lets a bot cap in the room replace the room default', async () => {
    const recording = recordingEngine({ costUsd: 0.6 });
    const ctx = await openContext(recording);
    const ana = await addBot(ctx, 'Ana');
    const lee = await addBot(ctx, 'Lee', { teamBudgetUsd: 5 });
    const cy = await addBot(ctx, 'Cy');
    const room = await createRoom(ctx, [ana.id, lee.id, cy.id], ana.id);

    await post(ctx, room.id, '@Ana @Lee @Cy plan the launch');

    await until(() => recording.runs.length === 3);
    expect(recording.runs.map((run) => run.bot.name)).toEqual(['Ana', 'Lee', 'Cy']);
    expect((await listMessages(ctx, room.id)).some((message) => message.role === 'system')).toBe(false);
  });
});

describe('room context for engines', () => {
  it('gives a room run its room, members and team tools, and a direct run neither room', async () => {
    const recording: Recording = recordingEngine();
    const ctx = await createTestContext({
      engines: createEngineRegistry([recording.driver]),
      computers: {},
      mcp: (core) => createBrotMcp(core),
      team: createTeamTools,
    });
    try {
      const ana = await addBot(ctx, 'Ana');
      const bo = await ctx.services.repos.bots.create({ name: 'Bo', job: 'Reviewer', engine: 'mock', computer: 'none', instructions: '' });
      const response = await call(ctx.app, 'POST', '/api/rooms', {
        title: 'Launch',
        botIds: [ana.id, bo.id],
        leadBotId: ana.id,
        responder: 'lead',
      });
      const room = await json<Thread>(response);

      await call(ctx.app, 'POST', `/api/threads/${room.id}/messages`, { content: 'status?' });
      await until(() => recording.runs.length === 1);
      const roomRun = recording.runs[0]!;
      expect(roomRun.room).toEqual({
        title: 'Launch',
        responder: 'lead',
        leadBotId: ana.id,
        members: expect.arrayContaining([
          { id: ana.id, name: 'Ana', job: 'Ana job' },
          { id: bo.id, name: 'Bo', job: 'Reviewer' },
        ]),
      });
      expect(roomRun.room?.members).toHaveLength(2);
      expect(roomRun.teamTools).toBe(true);
      expect(roomRun.mcpServers).toHaveLength(1);

      const direct = await json<Thread>(await call(ctx.app, 'POST', `/api/bots/${ana.id}/threads`, {}));
      await call(ctx.app, 'POST', `/api/threads/${direct.id}/messages`, { content: 'hello' });
      await until(() => recording.runs.length === 2);
      expect(recording.runs[1]?.room).toBeUndefined();
      expect(recording.runs[1]?.teamTools).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
