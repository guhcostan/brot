import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Memory, MemoryJournalEntry, MemoryUpkeepReport } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';
import {
  MemoryUpkeepConflictError,
  applyMemoryUpkeep,
  buildMemoryUpkeepReport,
  normalizeMemoryContent,
} from './upkeep';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const repos = () => ctx.services.repos;

/** A deterministic timestamp, `offset` seconds after 12:00:00 on 2026-10-22. */
function stamp(offset: number): string {
  return new Date(Date.UTC(2026, 9, 22, 12, 0, offset)).toISOString();
}

async function createBot(name = 'Ada'): Promise<Bot> {
  return repos().bots.create({ name, job: 'Researcher' });
}

async function botMemory(botId: string, content: string, kind: Memory['kind'] = 'fact'): Promise<Memory> {
  return repos().memories.create(botId, { kind, content });
}

async function workspaceMemory(content: string, kind: Memory['kind'] = 'fact'): Promise<Memory> {
  return repos().memories.create({ scope: 'workspace', kind, content });
}

async function setTimes(id: string, createdAt: string, updatedAt = createdAt): Promise<void> {
  await ctx.services.db.client.execute({
    sql: 'UPDATE memories SET created_at = ?, updated_at = ? WHERE id = ?',
    args: [createdAt, updatedAt, id],
  });
}

function ids(memories: readonly Memory[]): string[] {
  return memories.map((memory) => memory.id);
}

describe('normalizeMemoryContent', () => {
  it('trims, collapses whitespace, strips trailing punctuation and lowercases', () => {
    expect(normalizeMemoryContent('  Likes   TEA. ')).toBe('likes tea');
    expect(normalizeMemoryContent('Likes tea!!!')).toBe('likes tea');
    expect(normalizeMemoryContent('Likes tea…')).toBe('likes tea');
    expect(normalizeMemoryContent('Likes tea?!.')).toBe('likes tea');
    expect(normalizeMemoryContent('Likes\n\ntea\tnow')).toBe('likes tea now');
    expect(normalizeMemoryContent('   ')).toBe('');
    expect(normalizeMemoryContent('...')).toBe('');
  });

  it('keeps symbols that are not punctuation', () => {
    expect(normalizeMemoryContent('Likes 50%')).toBe('likes 50%');
    expect(normalizeMemoryContent('Writes C++')).toBe('writes c++');
  });
});

describe('buildMemoryUpkeepReport', () => {
  it('groups duplicates of one bot scope by kind and normalized text, keeping the newest', async () => {
    const ada = await createBot();
    const oldest = await botMemory(ada.id, 'Likes tea.');
    const middle = await botMemory(ada.id, 'likes  TEA');
    const newest = await botMemory(ada.id, 'Likes tea!!');
    const unique = await botMemory(ada.id, 'Lives in Lisbon');
    const otherKind = await botMemory(ada.id, 'Likes tea', 'preference');
    await setTimes(oldest.id, stamp(1));
    await setTimes(middle.id, stamp(2));
    await setTimes(newest.id, stamp(3));

    const report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    expect(report).toMatchObject({ scope: 'bot', botId: ada.id, total: 5, removable: 2 });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({ kind: 'fact', keep: { id: newest.id } });
    expect(ids(report.groups[0]?.remove ?? [])).toEqual([middle.id, oldest.id]);
    expect(ids([...(report.groups[0]?.remove ?? []), report.groups[0]?.keep ?? unique])).not.toContain(unique.id);
    expect(report.groups[0]?.keep.id).not.toBe(otherKind.id);
  });

  it('keeps bot and workspace scopes apart', async () => {
    const ada = await createBot();
    const botHit = await botMemory(ada.id, 'Likes tea');
    const workspaceOld = await workspaceMemory('Likes tea.');
    const workspaceNew = await workspaceMemory('LIKES TEA!');
    await setTimes(workspaceOld.id, stamp(1));
    await setTimes(workspaceNew.id, stamp(2));

    const workspace = await buildMemoryUpkeepReport(repos(), { scope: 'workspace' });
    expect(workspace).toMatchObject({ scope: 'workspace', total: 2, removable: 1 });
    expect(workspace.botId).toBeUndefined();
    expect(workspace.groups[0]?.keep.id).toBe(workspaceNew.id);
    expect(ids(workspace.groups[0]?.remove ?? [])).toEqual([workspaceOld.id]);

    const botReport = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    expect(botReport.groups).toEqual([]);
    expect(botReport.total).toBe(1);
    expect(botReport.removable).toBe(0);
    expect(ids(botReport.groups.flatMap((group) => [group.keep, ...group.remove]))).not.toContain(botHit.id);
  });

  it('does not mix bots', async () => {
    const ada = await createBot('Ada');
    const bo = await createBot('Bo');
    await botMemory(ada.id, 'Likes tea');
    await botMemory(ada.id, 'Likes tea.');
    const boSingle = await botMemory(bo.id, 'Likes tea');

    const adaReport = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    expect(adaReport.removable).toBe(1);

    const boReport = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: bo.id });
    expect(boReport).toMatchObject({ total: 1, removable: 0, groups: [] });
    expect(boReport.groups.flatMap((group) => ids(group.remove))).not.toContain(boSingle.id);
  });

  it('keeps the newest by updatedAt, then createdAt, then id', async () => {
    const ada = await createBot();

    // updatedAt wins even though createdAt says otherwise.
    const updatedOldest = await botMemory(ada.id, 'One');
    const updatedNewest = await botMemory(ada.id, 'one.');
    await setTimes(updatedOldest.id, stamp(5), stamp(9));
    await setTimes(updatedNewest.id, stamp(1), stamp(10));
    let report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    expect(report.groups[0]?.keep.id).toBe(updatedNewest.id);

    // Same updatedAt: the newer createdAt keeps.
    const createdOld = await botMemory(ada.id, 'Two');
    const createdNew = await botMemory(ada.id, 'two.');
    await setTimes(createdOld.id, stamp(20), stamp(21));
    await setTimes(createdNew.id, stamp(22), stamp(21));
    report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    expect(
      report.groups.find((group) => normalizeMemoryContent(group.keep.content) === 'two')?.keep.id,
    ).toBe(createdNew.id);

    // Same timestamps: the greater id keeps.
    const low = await botMemory(ada.id, 'Three');
    const high = await botMemory(ada.id, 'three.');
    await setTimes(low.id, stamp(30));
    await setTimes(high.id, stamp(30));
    report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    const three = report.groups.find((group) => normalizeMemoryContent(group.keep.content) === 'three');
    expect(three?.keep.id).toBe([low.id, high.id].sort().at(-1));
  });

  it('orders groups by removable count, then content', async () => {
    const ada = await createBot();
    for (const content of ['Alpha', 'Alpha.', 'Alpha!!']) await botMemory(ada.id, content);
    for (const content of ['Zeta', 'zeta.']) await botMemory(ada.id, content);
    for (const content of ['Zeta again', 'zeta again.', 'ZETA AGAIN!']) await botMemory(ada.id, content);

    const report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    expect(report.groups.map((group) => [normalizeMemoryContent(group.keep.content), group.remove.length])).toEqual([
      ['alpha', 2],
      ['zeta again', 2],
      ['zeta', 1],
    ]);
  });

  it('counts blank memories in the total but never groups them', async () => {
    const ada = await createBot();
    await botMemory(ada.id, '   ');
    await botMemory(ada.id, '\n\t ');
    const one = await botMemory(ada.id, 'Real fact');
    const two = await botMemory(ada.id, 'real fact.');
    await setTimes(one.id, stamp(1));
    await setTimes(two.id, stamp(2));

    const report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    expect(report).toMatchObject({ total: 4, removable: 1 });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.keep.id).toBe(two.id);
  });
});

describe('applyMemoryUpkeep', () => {
  it('removes the remove side, returns kept memories, and journals the deletions', async () => {
    const ada = await createBot();
    const oldest = await botMemory(ada.id, 'Likes tea.');
    const middle = await botMemory(ada.id, 'likes tea');
    const newest = await botMemory(ada.id, 'Likes tea!');
    const unique = await botMemory(ada.id, 'Lives in Lisbon');
    await setTimes(oldest.id, stamp(1));
    await setTimes(middle.id, stamp(2));
    await setTimes(newest.id, stamp(3));

    const report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    const result = await applyMemoryUpkeep(repos(), {
      scope: 'bot',
      botId: ada.id,
      removeIds: ids(report.groups[0]?.remove ?? []),
    });
    expect(new Set(ids(result.removed))).toEqual(new Set([oldest.id, middle.id]));
    expect(ids(result.kept)).toEqual([newest.id]);
    expect(ids(await repos().memories.listByBot(ada.id)).sort()).toEqual([newest.id, unique.id].sort());

    const deleted = (await repos().memoryJournal.list({ botId: ada.id })).filter((entry) => entry.action === 'deleted');
    expect(deleted).toHaveLength(2);
    for (const entry of deleted) {
      expect(entry).toMatchObject({ scope: 'bot', kind: 'fact', action: 'deleted' });
      expect(entry.memoryId).toBeUndefined();
      expect([oldest.content, middle.content]).toContain(entry.contentBefore);
    }
  });

  it('validates every id before deleting anything', async () => {
    const ada = await createBot();
    const oldest = await botMemory(ada.id, 'Likes tea.');
    const newest = await botMemory(ada.id, 'Likes tea!');
    const unique = await botMemory(ada.id, 'Lives in Lisbon');
    await setTimes(oldest.id, stamp(1));
    await setTimes(newest.id, stamp(2));

    async function expectRejected(removeIds: string[]): Promise<string[]> {
      const error = await applyMemoryUpkeep(repos(), { scope: 'bot', botId: ada.id, removeIds }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(MemoryUpkeepConflictError);
      return (error as MemoryUpkeepConflictError).ids;
    }

    expect(await expectRejected([oldest.id, newest.id])).toEqual([newest.id]);
    expect(await expectRejected([unique.id])).toEqual([unique.id]);
    expect(await expectRejected(['missing'])).toEqual(['missing']);

    expect(ids(await repos().memories.listByBot(ada.id)).sort()).toEqual([oldest.id, newest.id, unique.id].sort());
  });

  it('refuses a stale preview and removes nothing', async () => {
    const ada = await createBot();
    const first = await botMemory(ada.id, 'Likes tea.');
    const second = await botMemory(ada.id, 'Likes tea!');
    const third = await botMemory(ada.id, 'LIKES TEA');
    await setTimes(first.id, stamp(1));
    await setTimes(second.id, stamp(2));
    await setTimes(third.id, stamp(3));
    const report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    const preview = ids(report.groups[0]?.remove ?? []);
    await repos().memories.remove(preview[0] ?? '');

    await expect(
      applyMemoryUpkeep(repos(), { scope: 'bot', botId: ada.id, removeIds: preview }),
    ).rejects.toBeInstanceOf(MemoryUpkeepConflictError);
    expect(await repos().memories.listByBot(ada.id)).toHaveLength(2);
  });

  it('refuses ids from another scope', async () => {
    const ada = await createBot();
    const workspaceOld = await workspaceMemory('Shared fact');
    await workspaceMemory('Shared fact.');
    await setTimes(workspaceOld.id, stamp(1));
    const workspaceReport = await buildMemoryUpkeepReport(repos(), { scope: 'workspace' });
    const workspaceRemoval = ids(workspaceReport.groups[0]?.remove ?? []);
    expect(workspaceRemoval).toHaveLength(1);

    await expect(
      applyMemoryUpkeep(repos(), { scope: 'bot', botId: ada.id, removeIds: workspaceRemoval }),
    ).rejects.toBeInstanceOf(MemoryUpkeepConflictError);
    expect(await repos().memories.listWorkspace()).toHaveLength(2);
  });

  it('ignores repeated ids', async () => {
    const ada = await createBot();
    const first = await botMemory(ada.id, 'Likes tea.');
    await botMemory(ada.id, 'Likes tea!');
    await setTimes(first.id, stamp(1));
    const report = await buildMemoryUpkeepReport(repos(), { scope: 'bot', botId: ada.id });
    const removable = ids(report.groups[0]?.remove ?? []);
    const result = await applyMemoryUpkeep(repos(), {
      scope: 'bot',
      botId: ada.id,
      removeIds: [...removable, ...removable],
    });
    expect(result.removed).toHaveLength(1);
  });
});

describe('memory upkeep routes', () => {
  async function json<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  async function apiBot(name = 'Ada'): Promise<Bot> {
    const response = await call(ctx.app, 'POST', '/api/bots', { name, job: 'Researcher' });
    expect(response.status).toBe(201);
    return json<Bot>(response);
  }

  async function apiBotMemory(botId: string, content: string, kind = 'fact'): Promise<Memory> {
    const response = await call(ctx.app, 'POST', `/api/bots/${botId}/memories`, { kind, content });
    expect(response.status).toBe(201);
    return json<Memory>(response);
  }

  async function report(query: string): Promise<MemoryUpkeepReport> {
    const response = await call(ctx.app, 'GET', `/api/memories/upkeep${query}`);
    expect(response.status).toBe(200);
    return json<MemoryUpkeepReport>(response);
  }

  async function apply(body: Record<string, unknown>): Promise<Response> {
    return call(ctx.app, 'POST', '/api/memories/upkeep', body);
  }

  it('previews duplicates for a bot without removing anything', async () => {
    const ada = await apiBot();
    const oldest = await apiBotMemory(ada.id, 'Likes tea.');
    const newest = await apiBotMemory(ada.id, 'Likes tea!');
    await setTimes(oldest.id, stamp(1));
    await setTimes(newest.id, stamp(2));

    const preview = await report(`?scope=bot&botId=${ada.id}`);
    expect(preview).toMatchObject({ scope: 'bot', botId: ada.id, total: 2, removable: 1 });
    expect(preview.groups[0]?.keep.id).toBe(newest.id);
    expect(ids(preview.groups[0]?.remove ?? [])).toEqual([oldest.id]);

    const memories = await json<Memory[]>(await call(ctx.app, 'GET', `/api/bots/${ada.id}/memories`));
    expect(memories).toHaveLength(2);
  });

  it('previews workspace duplicates separately', async () => {
    const oldOne = await json<Memory>(
      await call(ctx.app, 'POST', '/api/profile/memories', { kind: 'fact', content: 'Shared fact.' }),
    );
    const newOne = await json<Memory>(
      await call(ctx.app, 'POST', '/api/profile/memories', { kind: 'fact', content: 'shared fact!' }),
    );
    await setTimes(oldOne.id, stamp(1));
    await setTimes(newOne.id, stamp(2));
    const ada = await apiBot();
    await apiBotMemory(ada.id, 'shared fact');

    const preview = await report('?scope=workspace');
    expect(preview).toMatchObject({ scope: 'workspace', total: 2, removable: 1 });
    expect(preview.botId).toBeUndefined();
    expect(preview.groups[0]?.keep.id).toBe(newOne.id);
  });

  it('applies a preview through the routes and writes journal deletions', async () => {
    const ada = await apiBot();
    const oldest = await apiBotMemory(ada.id, 'Likes tea.');
    const newest = await apiBotMemory(ada.id, 'Likes tea!');
    await setTimes(oldest.id, stamp(1));
    await setTimes(newest.id, stamp(2));
    const preview = await report(`?scope=bot&botId=${ada.id}`);
    const removal = ids(preview.groups[0]?.remove ?? []);

    const response = await apply({ scope: 'bot', botId: ada.id, removeIds: removal });
    expect(response.status).toBe(200);
    const result = await json<{ removed: Memory[]; kept: Memory[] }>(response);
    expect(ids(result.removed)).toEqual(removal);
    expect(ids(result.kept)).toEqual([newest.id]);

    const memories = await json<Memory[]>(await call(ctx.app, 'GET', `/api/bots/${ada.id}/memories`));
    expect(memories.map((memory) => memory.id)).toEqual([newest.id]);

    const journal = await json<MemoryJournalEntry[]>(
      await call(ctx.app, 'GET', `/api/memories/journal?botId=${ada.id}&scope=bot`),
    );
    expect(journal.filter((entry) => entry.action === 'deleted')).toHaveLength(1);
  });

  it('answers 400 and removes nothing when an id is not a removable duplicate', async () => {
    const ada = await apiBot();
    const oldest = await apiBotMemory(ada.id, 'Likes tea.');
    const newest = await apiBotMemory(ada.id, 'Likes tea!');
    const unique = await apiBotMemory(ada.id, 'Lives in Lisbon');
    await setTimes(oldest.id, stamp(1));
    await setTimes(newest.id, stamp(2));

    const keepAttempt = await apply({ scope: 'bot', botId: ada.id, removeIds: [newest.id] });
    expect(keepAttempt.status).toBe(400);
    expect(((await keepAttempt.json()) as { ids: string[] }).ids).toEqual([newest.id]);

    const uniqueAttempt = await apply({ scope: 'bot', botId: ada.id, removeIds: [unique.id] });
    expect(uniqueAttempt.status).toBe(400);

    const staleAttempt = await apply({ scope: 'bot', botId: ada.id, removeIds: [oldest.id, oldest.id] });
    expect(staleAttempt.status).toBe(200);
    expect(await repos().memories.listByBot(ada.id)).toHaveLength(2);
  });

  it('validates the scope and the bot on both routes', async () => {
    async function issuesAt(path: string): Promise<{ path: string[] }[]> {
      const response = await call(ctx.app, 'GET', path);
      expect(response.status).toBe(400);
      return ((await response.json()) as { issues: { path: string[] }[] }).issues;
    }

    expect((await issuesAt('/api/memories/upkeep'))[0]?.path).toEqual(['scope']);
    expect((await issuesAt('/api/memories/upkeep?scope=team'))[0]?.path).toEqual(['scope']);
    expect((await issuesAt('/api/memories/upkeep?scope=bot'))[0]?.path).toEqual(['botId']);
    expect((await issuesAt('/api/memories/upkeep?scope=workspace&botId=bot_1'))[0]?.path).toEqual(['botId']);
    expect((await issuesAt('/api/memories/upkeep?scope=bot&botId=missing'))[0]?.path).toEqual(['botId']);

    expect((await apply({ scope: 'bot', removeIds: ['m1'] })).status).toBe(400);
    expect((await apply({ scope: 'workspace', botId: 'bot_1', removeIds: ['m1'] })).status).toBe(400);
    expect((await apply({ scope: 'workspace', removeIds: [] })).status).toBe(400);
    expect((await apply({ scope: 'bot', botId: 'missing', removeIds: ['m1'] })).status).toBe(400);
  });
});
