import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Thread } from '@brot/protocol';
import { call, createTestContext, type TestContext } from './testing';

/** A model the seeded provider list knows. */
const KNOWN_MODEL = 'opencode-go/deepseek-v4.1-flash';

interface Issue {
  path: unknown[];
  message: string;
}

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

async function createThread(botId: string, body: Record<string, unknown> = {}): Promise<Thread> {
  const res = await call(ctx.app, 'POST', `/api/bots/${botId}/threads`, body);
  expect(res.status).toBe(201);
  return json<Thread>(res);
}

async function threadOf(botId: string, id: string): Promise<Thread | undefined> {
  return (await json<Thread[]>(await call(ctx.app, 'GET', `/api/bots/${botId}/threads?kind=dm`))).find(
    (thread) => thread.id === id,
  );
}

async function createRoom(): Promise<Thread> {
  const lead = await createBot({ name: 'Capy' });
  const other = await createBot({ name: 'Dex' });
  const res = await call(ctx.app, 'POST', '/api/rooms', {
    title: 'Room',
    botIds: [lead.id, other.id],
    leadBotId: lead.id,
  });
  expect(res.status).toBe(201);
  return json<Thread>(res);
}

function issuesOf(body: unknown): Issue[] {
  return (body as { issues: Issue[] }).issues;
}

describe('thread model override routes', () => {
  it('creates a DM thread with a model override and returns it', async () => {
    const bot = await createBot();

    const thread = await createThread(bot.id, { model: KNOWN_MODEL });

    expect(thread).toMatchObject({ title: 'New thread', model: KNOWN_MODEL });
    expect((await threadOf(bot.id, thread.id))?.model).toBe(KNOWN_MODEL);
  });

  it('rejects a malformed or unknown-provider model on create with a model issue', async () => {
    const bot = await createBot();

    const malformed = await call(ctx.app, 'POST', `/api/bots/${bot.id}/threads`, { model: 'no-slash' });
    expect(malformed.status).toBe(400);
    expect(issuesOf(await malformed.json()).some((issue) => issue.path.includes('model'))).toBe(true);

    const unknown = await call(ctx.app, 'POST', `/api/bots/${bot.id}/threads`, { model: 'ghost/model-1' });
    expect(unknown.status).toBe(400);
    const unknownBody = await unknown.json();
    expect(issuesOf(unknownBody).some((issue) => issue.path.includes('model'))).toBe(true);
    expect(issuesOf(unknownBody).find((issue) => issue.path.includes('model'))?.message).toContain('ghost');

    expect((await call(ctx.app, 'POST', '/api/bots/nope/threads', {})).status).toBe(404);
  });

  it('sets a thread model and clears it with null, keeping the title', async () => {
    const bot = await createBot();
    const thread = await createThread(bot.id, { title: 'Chat' });

    const set = await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { model: KNOWN_MODEL });
    expect(set.status).toBe(200);
    expect(await json<Thread>(set)).toMatchObject({ title: 'Chat', model: KNOWN_MODEL });

    const cleared = await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { model: null });
    expect(cleared.status).toBe(200);
    const clearedThread = await json<Thread>(cleared);
    expect(clearedThread.title).toBe('Chat');
    expect(clearedThread.model).toBeUndefined();

    const renamed = await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { title: 'Renamed' });
    expect(renamed.status).toBe(200);
    expect(await json<Thread>(renamed)).toMatchObject({ title: 'Renamed' });
  });

  it('rejects a malformed or unknown-provider model on update', async () => {
    const bot = await createBot();
    const thread = await createThread(bot.id);

    const malformed = await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { model: 'no-slash' });
    expect(malformed.status).toBe(400);
    expect(issuesOf(await malformed.json()).some((issue) => issue.path.includes('model'))).toBe(true);

    const unknown = await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { model: 'ghost/model-1' });
    expect(unknown.status).toBe(400);
    expect(issuesOf(await unknown.json()).some((issue) => issue.path.includes('model'))).toBe(true);

    expect((await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, {})).status).toBe(400);
    expect((await call(ctx.app, 'PATCH', '/api/threads/nope', { model: KNOWN_MODEL })).status).toBe(404);
  });

  it('refuses a model on a room thread, but lets a rename and model:null through', async () => {
    const room = await createRoom();

    const refused = await call(ctx.app, 'PATCH', `/api/threads/${room.id}`, { model: KNOWN_MODEL });
    expect(refused.status).toBe(400);
    const issue = issuesOf(await refused.json()).find((item) => item.path.includes('model'));
    expect(issue?.message).toMatch(/room/);

    expect((await call(ctx.app, 'PATCH', `/api/threads/${room.id}`, { model: null })).status).toBe(200);

    const renamed = await call(ctx.app, 'PATCH', `/api/threads/${room.id}`, { title: 'Renamed room' });
    expect(renamed.status).toBe(200);
    expect(await json<Thread>(renamed)).toMatchObject({ title: 'Renamed room' });
  });
});
