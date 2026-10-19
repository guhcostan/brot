import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@brot/protocol';
import { createDb, migrate, type BrotDb } from './index';
import { createRepos } from './repos';

const open: BrotDb[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const { client } of open.splice(0)) client.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDb(): Promise<BrotDb> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-db-concurrency-'));
  dirs.push(dir);
  const handle = await createDb(`file:${join(dir, 'brot.db')}`);
  open.push(handle);
  await migrate(handle.db);
  return handle;
}

describe('connection settings', () => {
  it('opens file databases in WAL with a busy timeout on the connection', async () => {
    const handle = await tempDb();

    expect((await handle.client.execute('PRAGMA journal_mode')).rows[0]?.journal_mode).toBe('wal');
    expect(Number((await handle.client.execute('PRAGMA busy_timeout')).rows[0]?.timeout)).toBe(5000);
    expect(Number((await handle.client.execute('PRAGMA foreign_keys')).rows[0]?.foreign_keys)).toBe(1);
  });
});

describe('write gate', () => {
  it('holds a write issued during an open transaction until that transaction commits', async () => {
    const handle = await tempDb();
    const repos = createRepos(handle.db);
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    const thread = await repos.threads.create(bot.id, { title: 'Chat' });

    const tx = await handle.client.transaction('write');
    await tx.execute({ sql: 'UPDATE bots SET name = name WHERE id = ?', args: [bot.id] });
    let landed = false;
    const write = repos.messages
      .create({ threadId: thread.id, role: 'assistant', content: 'during the transaction' })
      .then(() => {
        landed = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(landed).toBe(false);
    await tx.commit();
    await write;
    expect(landed).toBe(true);
    expect((await repos.messages.listByThread(thread.id)).map((m) => m.content)).toEqual(['during the transaction']);
  });

  it('releases the gate when a transaction is refused', async () => {
    const handle = await tempDb();
    const repos = createRepos(handle.db);
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    const thread = await repos.threads.create(bot.id, { title: 'Chat' });

    const delegator = await repos.bots.create({ name: 'Grace', job: 'x' });
    await expect(
      repos.tasks.create({
        title: 'Orphan',
        assigneeBotId: bot.id,
        createdByBotId: delegator.id,
        parentTaskId: 'task_missing',
        threadId: thread.id,
      }),
    ).rejects.toThrow(/does not exist/);

    const after = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'still writable' });
    expect(after.content).toBe('still writable');
  });
});

describe('concurrent writers on a file database', () => {
  it('lets transactions and plain writes from a run complete side by side', async () => {
    const handle = await tempDb();
    const repos = createRepos(handle.db);
    const lead = await repos.bots.create({ name: 'Onça', job: 'Lead' });
    const member = await repos.bots.create({ name: 'Capy', job: 'Helper' });
    const third = await repos.bots.create({ name: 'Ada', job: 'Researcher' });
    const thread = await repos.threads.create(lead.id, { title: 'Chat' });
    const run = await repos.runs.create({ threadId: thread.id, botId: lead.id, engine: 'mock' });

    // A run streaming events and messages while the team board and rooms are written in the same process.
    const streaming = (async () => {
      for (let i = 0; i < 150; i++) {
        const event: CanonicalEvent = {
          id: `evt-${i}`,
          at: new Date(Date.UTC(2026, 9, 19, 12, 0, 0, i)).toISOString(),
          threadId: thread.id,
          runId: run.id,
          type: 'message.delta',
          messageId: `msg-${i}`,
          delta: 'x',
        };
        await repos.events.append(event);
        await repos.messages.create({ threadId: thread.id, role: 'assistant', content: `chunk ${i}`, authorBotId: lead.id });
      }
    })();

    let lastRoomId = '';
    const board = (async () => {
      for (let i = 0; i < 30; i++) {
        const task = await repos.tasks.create({ title: `Task ${i}`, assigneeBotId: member.id, threadId: thread.id });
        await repos.tasks.create({
          title: `Child ${i}`,
          assigneeBotId: lead.id,
          createdByBotId: member.id,
          parentTaskId: task.id,
          threadId: thread.id,
        });
        const room = await repos.rooms.create({
          title: `Room ${i}`,
          botIds: [lead.id, member.id, third.id],
          leadBotId: lead.id,
        });
        await repos.rooms.updateMembers(room.id, { remove: [member.id] });
        await repos.rooms.updateMembers(room.id, { add: [member.id] });
        lastRoomId = room.id;
      }
    })();

    await Promise.all([streaming, board]);

    expect(await repos.events.list({ threadId: thread.id, limit: 1000 })).toHaveLength(150);
    expect(await repos.messages.listByThread(thread.id)).toHaveLength(150);
    expect(await repos.tasks.list({ threadId: thread.id })).toHaveLength(60);
    expect((await repos.rooms.listMembers(lastRoomId)).map((m) => m.botId).sort()).toEqual(
      [lead.id, member.id, third.id].sort(),
    );
  });
});
