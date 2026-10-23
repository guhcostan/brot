import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Memory, MemoryJournalEntry, UndoMemoryResult } from '@brot/protocol';
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

async function createBot(body: Record<string, unknown> = {}): Promise<Bot> {
  const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', ...body });
  expect(res.status).toBe(201);
  return json<Bot>(res);
}

async function createMemory(botId: string, body: Record<string, unknown> = {}): Promise<Memory> {
  const res = await call(ctx.app, 'POST', `/api/bots/${botId}/memories`, { kind: 'fact', content: 'Likes tea', ...body });
  expect(res.status).toBe(201);
  return json<Memory>(res);
}

async function listJournal(query = ''): Promise<MemoryJournalEntry[]> {
  const res = await call(ctx.app, 'GET', `/api/memories/journal${query}`);
  expect(res.status).toBe(200);
  return json<MemoryJournalEntry[]>(res);
}

async function latestEntry(action: MemoryJournalEntry['action']): Promise<MemoryJournalEntry> {
  const entry = (await listJournal()).find((item) => item.action === action);
  if (entry === undefined) throw new Error(`no ${action} journal entry`);
  return entry;
}

async function undo(entryId: string): Promise<Response> {
  return call(ctx.app, 'POST', `/api/memories/journal/${entryId}/undo`);
}

describe('memory journal routes', () => {
  it('lists every write, newest first, with the content around it', async () => {
    const bot = await createBot();
    expect(await listJournal()).toEqual([]);

    const memory = await createMemory(bot.id);
    const patched = await call(ctx.app, 'PATCH', `/api/memories/${memory.id}`, {
      content: 'Prefers green tea',
      kind: 'preference',
    });
    expect(patched.status).toBe(200);
    expect((await call(ctx.app, 'DELETE', `/api/memories/${memory.id}`)).status).toBe(204);

    const entries = await listJournal();
    expect(entries.map((entry) => entry.action)).toEqual(['deleted', 'updated', 'created']);
    const [deleted, edit, created] = entries;
    expect(created).toMatchObject({ botId: bot.id, scope: 'bot', kind: 'fact', action: 'created', contentAfter: 'Likes tea' });
    expect(edit).toMatchObject({ botId: bot.id, kind: 'preference', action: 'updated', contentBefore: 'Likes tea', contentAfter: 'Prefers green tea' });
    expect(deleted).toMatchObject({ botId: bot.id, kind: 'preference', action: 'deleted', contentBefore: 'Prefers green tea' });
    expect(deleted?.memoryId).toBeUndefined();
  });

  it('captures writes that did not come through the memory routes', async () => {
    const bot = await createBot();
    await ctx.services.repos.memories.create(bot.id, { kind: 'fact', content: 'Lives in Lisbon' });

    const [entry] = await listJournal(`?botId=${bot.id}`);
    expect(entry).toMatchObject({ botId: bot.id, action: 'created', contentAfter: 'Lives in Lisbon' });
  });

  it('filters by bot and scope and caps the limit', async () => {
    const ada = await createBot();
    const bo = await createBot({ name: 'Bo' });
    await createMemory(ada.id);
    await createMemory(bo.id);
    const workspace = await json<Memory>(
      await call(ctx.app, 'POST', '/api/profile/memories', { kind: 'preference', content: 'Works in Lisbon' }),
    );

    expect(await listJournal(`?botId=${ada.id}`)).toMatchObject([{ botId: ada.id }]);
    expect(await listJournal('?scope=workspace')).toMatchObject([{ scope: 'workspace', memoryId: workspace.id }]);
    expect((await listJournal('?scope=bot')).every((entry) => entry.scope === 'bot')).toBe(true);
    expect(await listJournal('?limit=2')).toHaveLength(2);

    expect((await call(ctx.app, 'GET', '/api/memories/journal?scope=team')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/memories/journal?limit=0')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/memories/journal?limit=201')).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/memories/journal?limit=many')).status).toBe(400);
  });

  it('undoes a creation by removing the memory and journaling the removal', async () => {
    const bot = await createBot();
    const memory = await createMemory(bot.id);
    const created = await latestEntry('created');

    const response = await undo(created.id);
    expect(response.status).toBe(200);
    expect(await json<UndoMemoryResult>(response)).toEqual({ result: 'removed' });
    expect(await json<Memory[]>(await call(ctx.app, 'GET', `/api/bots/${bot.id}/memories`))).toEqual([]);
    expect((await listJournal()).filter((entry) => entry.action === 'deleted')).toHaveLength(1);

    const again = await undo(created.id);
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toMatch(/gone/);
    expect(memory.id).toBeDefined();
  });

  it('refuses to undo a creation whose memory changed since', async () => {
    const bot = await createBot();
    const memory = await createMemory(bot.id);
    await call(ctx.app, 'PATCH', `/api/memories/${memory.id}`, { content: 'Prefers coffee' });
    const created = await latestEntry('created');

    const response = await undo(created.id);

    expect(response.status).toBe(409);
    expect(await json<{ error: string }>(response)).toEqual({
      error: 'This memory changed after it was created; edit it instead.',
    });
  });

  it('undoes an edit by restoring the previous content, and journals that restore', async () => {
    const bot = await createBot();
    const memory = await createMemory(bot.id);
    await call(ctx.app, 'PATCH', `/api/memories/${memory.id}`, { content: 'Prefers green tea' });
    const edit = await latestEntry('updated');

    const response = await undo(edit.id);

    expect(response.status).toBe(200);
    const result = await json<UndoMemoryResult>(response);
    expect(result.result).toBe('restored');
    expect(result.memory).toMatchObject({ id: memory.id, content: 'Likes tea' });
    expect((await listJournal()).filter((entry) => entry.action === 'updated')).toHaveLength(2);
    expect((await listJournal())[0]).toMatchObject({ action: 'updated', contentBefore: 'Prefers green tea', contentAfter: 'Likes tea' });
  });

  it('refuses to undo an edit whose memory changed again or is gone', async () => {
    const bot = await createBot();
    const memory = await createMemory(bot.id);
    await call(ctx.app, 'PATCH', `/api/memories/${memory.id}`, { content: 'Prefers green tea' });
    const firstEdit = await latestEntry('updated');
    await call(ctx.app, 'PATCH', `/api/memories/${memory.id}`, { content: 'Prefers coffee' });

    const changed = await undo(firstEdit.id);
    expect(changed.status).toBe(409);
    expect((await json<{ error: string }>(changed)).error).toMatch(/changed/);

    await call(ctx.app, 'DELETE', `/api/memories/${memory.id}`);
    const gone = await undo(firstEdit.id);
    expect(gone.status).toBe(409);
    expect((await json<{ error: string }>(gone)).error).toMatch(/gone/);
  });

  it('undoes a deletion by recreating the memory', async () => {
    const bot = await createBot();
    const memory = await createMemory(bot.id);
    await call(ctx.app, 'DELETE', `/api/memories/${memory.id}`);
    const deletion = await latestEntry('deleted');

    const response = await undo(deletion.id);

    expect(response.status).toBe(200);
    const result = await json<UndoMemoryResult>(response);
    expect(result.result).toBe('restored');
    expect(result.memory).toMatchObject({ botId: bot.id, scope: 'bot', kind: 'fact', content: 'Likes tea' });
    expect(result.memory?.id).not.toBe(memory.id);
    expect((await listJournal()).filter((entry) => entry.action === 'created')).toHaveLength(2);
  });

  it('undoes a workspace memory deletion', async () => {
    const workspace = await json<Memory>(
      await call(ctx.app, 'POST', '/api/profile/memories', { kind: 'preference', content: 'Works in Lisbon' }),
    );
    await call(ctx.app, 'DELETE', `/api/memories/${workspace.id}`);
    const deletion = await latestEntry('deleted');

    const result = await json<UndoMemoryResult>(await undo(deletion.id));

    expect(result.result).toBe('restored');
    expect(result.memory).toMatchObject({ scope: 'workspace', kind: 'preference', content: 'Works in Lisbon' });
    expect(await json<Memory[]>(await call(ctx.app, 'GET', '/api/profile/memories'))).toHaveLength(1);
  });

  it('refuses to restore a deleted bot memory after its bot is deleted', async () => {
    const bot = await createBot();
    const memory = await createMemory(bot.id);
    await call(ctx.app, 'DELETE', `/api/memories/${memory.id}`);
    const deletion = await latestEntry('deleted');
    expect((await call(ctx.app, 'DELETE', `/api/bots/${bot.id}`)).status).toBe(204);

    const response = await undo(deletion.id);

    expect(response.status).toBe(409);
    expect((await json<{ error: string }>(response)).error).toMatch(/bot/);
  });

  it('returns 404 for an unknown journal entry', async () => {
    expect((await undo('missing')).status).toBe(404);
  });
});
