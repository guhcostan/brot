import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Team, Thread } from '@brot/protocol';
import { call, createTestContext, recordEvents, waitUntil, type TestContext } from './testing';

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

async function createTeam(body: Record<string, unknown>): Promise<Team> {
  const res = await call(ctx.app, 'POST', '/api/teams', body);
  expect(res.status).toBe(201);
  return json<Team>(res);
}

async function createThread(botId: string, body: Record<string, unknown> = {}): Promise<Thread> {
  const res = await call(ctx.app, 'POST', `/api/bots/${botId}/threads`, body);
  expect(res.status).toBe(201);
  return json<Thread>(res);
}

async function threadsOf(botId: string): Promise<Thread[]> {
  return json<Thread[]>(await call(ctx.app, 'GET', `/api/bots/${botId}/threads?kind=dm`));
}

async function titleOf(botId: string, threadId: string): Promise<string | undefined> {
  return (await threadsOf(botId)).find((thread) => thread.id === threadId)?.title;
}

/** Posts a message and waits for every reply the mock engine starts for it. */
async function postMessage(threadId: string, content: string, runs = 1): Promise<void> {
  const events = recordEvents(ctx.services.bus, threadId);
  try {
    const res = await call(ctx.app, 'POST', `/api/threads/${threadId}/messages`, { content });
    expect(res.status).toBe(202);
    await waitUntil(
      () =>
        events.list.filter((event) => event.type === 'run.completed' || event.type === 'run.failed').length >= runs
          ? true
          : undefined,
    );
  } finally {
    events.stop();
  }
}

describe('teams API', () => {
  it('creates teams with an empty brief by default, lists them by name, and updates them', async () => {
    const growth = await createTeam({ name: 'Growth' });
    expect(growth).toMatchObject({ name: 'Growth', instructions: '' });
    expect(growth.chiefBotId).toBeUndefined();

    const chief = await createBot();
    const ops = await createTeam({ name: 'Ops', instructions: 'Keep it running.', chiefBotId: chief.id });
    expect(ops).toMatchObject({ name: 'Ops', instructions: 'Keep it running.', chiefBotId: chief.id });

    const listed = await json<Team[]>(await call(ctx.app, 'GET', '/api/teams'));
    expect(listed.map((team) => team.name)).toEqual(['Growth', 'Ops']);
    expect(listed.find((team) => team.id === ops.id)).toEqual(ops);

    const patched = await call(ctx.app, 'PATCH', `/api/teams/${ops.id}`, {
      name: 'Operations',
      instructions: 'Run the platform.',
    });
    expect(patched.status).toBe(200);
    expect(await json<Team>(patched)).toMatchObject({ name: 'Operations', instructions: 'Run the platform.' });

    const cleared = await call(ctx.app, 'PATCH', `/api/teams/${ops.id}`, { chiefBotId: null });
    expect(cleared.status).toBe(200);
    expect((await json<Team>(cleared)).chiefBotId).toBeUndefined();
  });

  it('rejects invalid team bodies and unknown chiefs with 400', async () => {
    const empty = await call(ctx.app, 'POST', '/api/teams', {});
    expect(empty.status).toBe(400);
    expect((await json<{ error: string; issues: { path: unknown[] }[] }>(empty)).issues.some((i) => i.path.includes('name'))).toBe(
      true,
    );

    const noName = await call(ctx.app, 'POST', '/api/teams', { name: '' });
    expect(noName.status).toBe(400);

    const unknownChief = await call(ctx.app, 'POST', '/api/teams', { name: 'Ops', chiefBotId: 'nobody' });
    expect(unknownChief.status).toBe(400);
    expect(await json<{ error: string }>(unknownChief)).toMatchObject({ error: 'Invalid request' });

    const team = await createTeam({ name: 'Growth' });
    const badPatch = await call(ctx.app, 'PATCH', `/api/teams/${team.id}`, { name: '' });
    expect(badPatch.status).toBe(400);
    const unknownChiefPatch = await call(ctx.app, 'PATCH', `/api/teams/${team.id}`, { chiefBotId: 'nobody' });
    expect(unknownChiefPatch.status).toBe(400);
  });

  it('returns 404 for unknown teams', async () => {
    expect((await call(ctx.app, 'PATCH', '/api/teams/nope', { name: 'x' })).status).toBe(404);
    expect((await call(ctx.app, 'DELETE', '/api/teams/nope')).status).toBe(404);
  });

  it('groups a bot through the API and clears it with a null teamId', async () => {
    const team = await createTeam({ name: 'Growth' });
    const bot = await createBot({ teamId: team.id });
    expect(bot.teamId).toBe(team.id);

    const ungrouped = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { teamId: null });
    expect(ungrouped.status).toBe(200);
    expect((await json<Bot>(ungrouped)).teamId).toBeUndefined();

    const regrouped = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { teamId: team.id });
    expect((await json<Bot>(regrouped)).teamId).toBe(team.id);
  });

  it('deletes a team, ungrouping its bots and keeping the bots', async () => {
    const chief = await createBot({ name: 'Capy' });
    const team = await createTeam({ name: 'Growth', chiefBotId: chief.id });
    const member = await createBot({ name: 'Dex', teamId: team.id });
    const outside = await createBot({ name: 'Ivy' });

    expect((await call(ctx.app, 'DELETE', `/api/teams/${team.id}`)).status).toBe(204);

    expect(await json<Team[]>(await call(ctx.app, 'GET', '/api/teams'))).toEqual([]);
    expect(await json<Bot>(await call(ctx.app, 'GET', `/api/bots/${member.id}`))).toMatchObject({
      id: member.id,
      name: 'Dex',
    });
    expect((await json<Bot>(await call(ctx.app, 'GET', `/api/bots/${member.id}`))).teamId).toBeUndefined();
    expect((await json<Bot>(await call(ctx.app, 'GET', `/api/bots/${outside.id}`))).teamId).toBeUndefined();
  });
});

describe('thread titles', () => {
  it('renames a thread and rejects an empty or overlong title', async () => {
    const bot = await createBot();
    const thread = await createThread(bot.id, { title: 'Original' });

    const renamed = await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { title: 'Launch plan' });
    expect(renamed.status).toBe(200);
    expect(await json<Thread>(renamed)).toMatchObject({ id: thread.id, title: 'Launch plan' });
    expect(await titleOf(bot.id, thread.id)).toBe('Launch plan');

    expect((await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { title: '' })).status).toBe(400);
    expect((await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, { title: 'x'.repeat(121) })).status).toBe(400);
    expect((await call(ctx.app, 'PATCH', `/api/threads/${thread.id}`, {})).status).toBe(400);
    expect((await call(ctx.app, 'PATCH', '/api/threads/nope', { title: 'x' })).status).toBe(404);
  });

  it("titles a default thread from the first line of the user's first message, once", async () => {
    const bot = await createBot();
    const thread = await createThread(bot.id);
    expect(thread.title).toBe('New thread');

    await postMessage(thread.id, 'Plan the launch\nand then some more detail');
    expect(await titleOf(bot.id, thread.id)).toBe('Plan the launch');

    await postMessage(thread.id, 'A different topic entirely');
    expect(await titleOf(bot.id, thread.id)).toBe('Plan the launch');
  });

  it('leaves a title the user chose alone, and titles a thread whose title is empty', async () => {
    const bot = await createBot();
    const named = await createThread(bot.id, { title: 'Chosen by the user' });
    await postMessage(named.id, 'First message');
    expect(await titleOf(bot.id, named.id)).toBe('Chosen by the user');

    const blank = await createThread(bot.id);
    await ctx.services.repos.threads.setTitle(blank.id, '');
    await postMessage(blank.id, '  From the empty title  ');
    expect(await titleOf(bot.id, blank.id)).toBe('From the empty title');
  });

  it('cuts the title to 80 code units without splitting a surrogate pair', async () => {
    const bot = await createBot();
    const long = await createThread(bot.id);
    await postMessage(long.id, 'a'.repeat(200));
    expect(await titleOf(bot.id, long.id)).toBe('a'.repeat(80));

    const emoji = await createThread(bot.id);
    await postMessage(emoji.id, `${'a'.repeat(79)}\u{1F600}tail`);
    expect(await titleOf(bot.id, emoji.id)).toBe('a'.repeat(79));
  });

  it('titles a room from the first user message that nobody mentions', async () => {
    const capy = await createBot({ name: 'Capy' });
    const dex = await createBot({ name: 'Dex' });
    const res = await call(ctx.app, 'POST', '/api/rooms', {
      title: 'New thread',
      botIds: [capy.id, dex.id],
      leadBotId: capy.id,
    });
    expect(res.status).toBe(201);
    const room = await json<Thread>(res);

    await postMessage(room.id, 'Room kickoff\nagenda follows');

    const rooms = await json<Thread[]>(await call(ctx.app, 'GET', '/api/rooms'));
    expect(rooms.find((item) => item.id === room.id)?.title).toBe('Room kickoff');
  });
});
