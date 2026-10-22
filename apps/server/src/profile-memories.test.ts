import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Memory } from '@brot/protocol';
import { call, createTestContext, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createBot(overrides: Record<string, unknown> = {}): Promise<Bot> {
  const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', ...overrides });
  expect(res.status).toBe(201);
  return json<Bot>(res);
}

async function createWorkspaceMemory(body: Record<string, unknown> = {}): Promise<Memory> {
  const res = await call(ctx.app, 'POST', '/api/profile/memories', {
    kind: 'fact',
    content: 'Works in Lisbon',
    ...body,
  });
  expect(res.status).toBe(201);
  return json<Memory>(res);
}

async function profileMemories(): Promise<Memory[]> {
  return json<Memory[]>(await call(ctx.app, 'GET', '/api/profile/memories'));
}

async function botMemories(botId: string): Promise<Memory[]> {
  return json<Memory[]>(await call(ctx.app, 'GET', `/api/bots/${botId}/memories`));
}

describe('profile memory routes', () => {
  it('creates workspace memories and lists them apart from bot memories', async () => {
    const bot = await createBot();

    const workspace = await createWorkspaceMemory({ kind: 'preference', content: 'Prefers morning calls' });
    expect(workspace).toMatchObject({ kind: 'preference', content: 'Prefers morning calls', scope: 'workspace' });
    expect(workspace.botId).toBeUndefined();

    const botMemory = await json<Memory>(
      await call(ctx.app, 'POST', `/api/bots/${bot.id}/memories`, { kind: 'fact', content: 'Likes tea' }),
    );
    expect(botMemory).toMatchObject({ botId: bot.id, scope: 'bot' });

    expect((await profileMemories()).map((memory) => memory.id)).toEqual([workspace.id]);
    expect((await botMemories(bot.id)).map((memory) => memory.id)).toEqual([botMemory.id]);
  });

  it('updates and deletes memories of either scope through the shared routes', async () => {
    const bot = await createBot();
    const workspace = await createWorkspaceMemory();
    const botMemory = await json<Memory>(
      await call(ctx.app, 'POST', `/api/bots/${bot.id}/memories`, { kind: 'fact', content: 'Likes tea' }),
    );

    const updatedWorkspace = await call(ctx.app, 'PATCH', `/api/memories/${workspace.id}`, {
      content: 'Lives in Lisbon',
    });
    expect(updatedWorkspace.status).toBe(200);
    expect(await json<Memory>(updatedWorkspace)).toMatchObject({ content: 'Lives in Lisbon', scope: 'workspace' });

    const updatedBot = await call(ctx.app, 'PATCH', `/api/memories/${botMemory.id}`, { kind: 'preference' });
    expect(updatedBot.status).toBe(200);
    expect(await json<Memory>(updatedBot)).toMatchObject({ kind: 'preference', scope: 'bot' });

    expect((await call(ctx.app, 'DELETE', `/api/memories/${workspace.id}`)).status).toBe(204);
    expect((await call(ctx.app, 'DELETE', `/api/memories/${botMemory.id}`)).status).toBe(204);
    expect(await profileMemories()).toEqual([]);
    expect(await botMemories(bot.id)).toEqual([]);

    expect((await call(ctx.app, 'PATCH', '/api/memories/nope', { content: 'x' })).status).toBe(404);
    expect((await call(ctx.app, 'DELETE', '/api/memories/nope')).status).toBe(404);
  });

  it('rejects a botId on a workspace create and an unknown bot on a bot create', async () => {
    const refused = await call(ctx.app, 'POST', '/api/profile/memories', {
      kind: 'fact',
      content: 'Works in Lisbon',
      botId: 'bot_1',
    });
    expect(refused.status).toBe(400);
    expect(await json<{ error: string }>(refused)).toMatchObject({ error: 'Invalid request' });

    expect(
      (await call(ctx.app, 'POST', '/api/bots/nope/memories', { kind: 'fact', content: 'Likes tea' })).status,
    ).toBe(404);
  });

  it('keeps workspace memories when their bot is deleted', async () => {
    const bot = await createBot();
    const workspace = await createWorkspaceMemory();
    const botMemory = await json<Memory>(
      await call(ctx.app, 'POST', `/api/bots/${bot.id}/memories`, { kind: 'fact', content: 'Likes tea' }),
    );

    expect((await call(ctx.app, 'DELETE', `/api/bots/${bot.id}`)).status).toBe(204);

    expect((await profileMemories()).map((memory) => memory.id)).toEqual([workspace.id]);
    expect((await call(ctx.app, 'GET', `/api/bots/${bot.id}/memories`)).status).toBe(404);
    expect(await json<Memory[]>(await call(ctx.app, 'GET', '/api/profile/memories'))).not.toContainEqual(
      expect.objectContaining({ id: botMemory.id }),
    );
  });
});
