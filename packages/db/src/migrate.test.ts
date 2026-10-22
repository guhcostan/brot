import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrate, type BrotDb } from './index';
import { createRepos } from './repos';

const open: BrotDb[] = [];
const dirs: string[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

afterEach(async () => {
  for (const { client } of open.splice(0)) client.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tempDb(): Promise<{ handle: BrotDb; url: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-db-test-'));
  dirs.push(dir);
  const url = `file:${join(dir, 'brot.db')}`;
  const handle = await createDb(url);
  open.push(handle);
  return { handle, url };
}

async function tableNames(handle: BrotDb): Promise<string[]> {
  const result = await handle.client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

async function columnNames(handle: BrotDb, table: string): Promise<string[]> {
  const result = await handle.client.execute(`PRAGMA table_info(${table})`);
  return result.rows.map((row) => String(row.name));
}

describe('migrate', () => {
  it('creates every table and can run twice', async () => {
    const { handle } = await tempDb();

    await migrate(handle.db);
    await migrate(handle.db);

    expect(await tableNames(handle)).toEqual([
      '__drizzle_migrations',
      'approvals',
      'attachments',
      'bots',
      'computers',
      'devices',
      'events',
      'mcp_servers',
      'memories',
      'messages',
      'notifications',
      'policies',
      'room_members',
      'routine_runs',
      'routines',
      'runs',
      'skills',
      'tasks',
      'teams',
      'thread_sessions',
      'threads',
    ]);

    const applied = await handle.client.execute('SELECT COUNT(*) AS count FROM __drizzle_migrations');
    expect(Number(applied.rows[0]?.count)).toBe(11);
  });

  it('adds the rooms, team task, and per-bot session schema on a fresh database', async () => {
    const { handle } = await tempDb();
    await migrate(handle.db);

    expect(await columnNames(handle, 'threads')).toEqual(
      expect.arrayContaining(['kind', 'lead_bot_id', 'responder', 'engine_session_id']),
    );
    expect(await columnNames(handle, 'messages')).toEqual(
      expect.arrayContaining(['author_bot_id', 'mentions', 'via_bot_id']),
    );
    expect(await columnNames(handle, 'bots')).toContain('team_budget_usd');
    expect(await columnNames(handle, 'tasks')).toEqual([
      'id',
      'title',
      'description',
      'status',
      'assignee_bot_id',
      'created_by_bot_id',
      'created_by_user',
      'parent_task_id',
      'thread_id',
      'work_thread_id',
      'result',
      'chain_id',
      'depth',
      'created_at',
      'updated_at',
      'work_run_id',
    ]);
    expect(await columnNames(handle, 'thread_sessions')).toEqual(['thread_id', 'bot_id', 'engine_session_id', 'updated_at']);
    expect(await columnNames(handle, 'room_members')).toEqual(['thread_id', 'bot_id', 'joined_at']);
  });

  it('upgrades a wave 4 database in place: old threads become DMs and bots that authored messages can still be deleted', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const [wave3, wave4] = journal.entries;
    if (!wave3 || !wave4) throw new Error('journal must hold the wave 3 and wave 4 migrations');

    // Recreate the database as wave 4 left it: the first two migrations applied, with data in them.
    for (const entry of [wave3, wave4]) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of [wave3, wave4]) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }
    await handle.client.execute(
      `INSERT INTO bots (id, name, job, instructions, engine, computer, pinned, archived, created_at, updated_at)
       VALUES ('bot_old', 'Ada', 'Researcher', '', 'mock', 'none', 0, 0, '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.000Z')`,
    );
    await handle.client.execute(
      `INSERT INTO threads (id, bot_id, title, engine_session_id, created_at, updated_at)
       VALUES ('thread_old', 'bot_old', 'Chat', 'sess_1', '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.000Z')`,
    );
    await handle.client.execute(
      `INSERT INTO messages (id, thread_id, role, content, created_at)
       VALUES ('msg_old', 'thread_old', 'user', 'Hi', '2026-10-19T10:00:00.000Z')`,
    );

    await migrate(handle.db);

    const repos = createRepos(handle.db);
    const thread = await repos.threads.get('thread_old');
    expect(thread).toMatchObject({ kind: 'dm', botId: 'bot_old', engineSessionId: 'sess_1' });
    expect(thread?.leadBotId).toBeUndefined();
    expect(thread?.responder).toBeUndefined();
    expect((await repos.threads.listByBot('bot_old', { kind: 'dm' })).map((t) => t.id)).toEqual(['thread_old']);
    expect((await repos.bots.get('bot_old'))?.teamBudgetUsd).toBeUndefined();

    const [old] = await repos.messages.listByThread('thread_old');
    expect(old).toMatchObject({ id: 'msg_old', content: 'Hi' });
    expect(old?.authorBotId).toBeUndefined();
    expect(old?.mentions).toBeUndefined();

    // A bot that wrote a message in a room is deleted without being blocked: the message keeps its text
    // and loses the author link.
    const capy = await repos.bots.create({ name: 'Capy', job: 'Helper' });
    await repos.messages.create({ threadId: 'thread_old', role: 'assistant', content: 'From Capy', authorBotId: capy.id });
    expect(await repos.bots.remove(capy.id)).toBe(true);
    const survivor = (await repos.messages.listByThread('thread_old')).find((m) => m.content === 'From Capy');
    expect(survivor?.authorBotId).toBeUndefined();
  });

  it('adds the wave 4 columns and the computer-per-bot constraint on a fresh database', async () => {
    const { handle } = await tempDb();
    await migrate(handle.db);

    expect(await columnNames(handle, 'bots')).toContain('egress');
    expect(await columnNames(handle, 'threads')).toContain('engine_session_id');
    expect(await columnNames(handle, 'computers')).toEqual([
      'id',
      'bot_id',
      'state',
      'image',
      'error',
      'created_at',
      'updated_at',
    ]);

    const indexes = await handle.client.execute("PRAGMA index_list('computers')");
    expect(indexes.rows.some((row) => row.name === 'computers_bot_uq' && Number(row.unique) === 1)).toBe(true);
  });

  it('upgrades a wave 3 database in place, keeping rows and giving bots the deny-all egress default', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const [wave3] = journal.entries;
    if (!wave3) throw new Error('journal has no entries');

    // Recreate the database as wave 3 left it: only the first migration applied.
    await handle.client.executeMultiple(
      await readFile(join(migrationsFolder, `${wave3.tag}.sql`), 'utf8'),
    );
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    await handle.client.execute({
      sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
      args: ['wave-3', wave3.when],
    });
    await handle.client.execute({
      sql: `INSERT INTO bots (id, name, job, instructions, engine, computer, pinned, archived, created_at, updated_at)
            VALUES ('bot_old', 'Ada', 'Researcher', '', 'mock', 'none', 0, 0, '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.000Z')`,
      args: [],
    });
    await handle.client.execute({
      sql: `INSERT INTO threads (id, bot_id, title, created_at, updated_at)
            VALUES ('thread_old', 'bot_old', 'Chat', '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.000Z')`,
      args: [],
    });

    await migrate(handle.db);

    const repos = createRepos(handle.db);
    const bot = await repos.bots.get('bot_old');
    expect(bot).toMatchObject({ name: 'Ada', computer: 'none' });
    expect(bot?.egress).toEqual({ mode: 'deny', allow: [] });

    const thread = await repos.threads.get('thread_old');
    expect(thread?.title).toBe('Chat');
    expect(thread?.engineSessionId).toBeUndefined();
  });

  it('upgrades a wave 5 team database in place: tasks gain a work run that clears when the run is deleted', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.slice(0, 3);
    if (applied.length !== 3 || applied[2]?.tag !== '0002_team_rooms_tasks') {
      throw new Error('journal must start with the 0000, 0001 and 0002 migrations');
    }

    // Recreate the database as it was before the work run column: the first three migrations applied.
    for (const entry of applied) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of applied) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }
    const stamp = '2026-10-19T10:00:00.000Z';
    await handle.client.execute({
      sql: `INSERT INTO bots (id, name, job, instructions, engine, computer, pinned, archived, created_at, updated_at)
            VALUES ('bot_old', 'Ada', 'Researcher', '', 'mock', 'none', 0, 0, ?, ?)`,
      args: [stamp, stamp],
    });
    await handle.client.execute({
      sql: `INSERT INTO threads (id, bot_id, title, kind, created_at, updated_at)
            VALUES ('thread_old', 'bot_old', 'Chat', 'dm', ?, ?)`,
      args: [stamp, stamp],
    });
    await handle.client.execute({
      sql: `INSERT INTO runs (id, thread_id, bot_id, status, engine, started_at, tokens_in, tokens_out, cost_usd)
            VALUES ('run_old', 'thread_old', 'bot_old', 'running', 'mock', ?, 0, 0, 0)`,
      args: [stamp],
    });
    await handle.client.execute({
      sql: `INSERT INTO tasks (id, title, status, assignee_bot_id, created_by_user, thread_id, chain_id, depth, created_at, updated_at)
            VALUES ('task_old', 'Ship', 'in_progress', 'bot_old', 1, 'thread_old', 'task_old', 0, ?, ?)`,
      args: [stamp, stamp],
    });

    await migrate(handle.db);

    const repos = createRepos(handle.db);
    const before = await repos.tasks.get('task_old');
    expect(before).toMatchObject({ title: 'Ship', status: 'in_progress', chainId: 'task_old' });
    expect(before?.workRunId).toBeUndefined();

    const linked = await repos.tasks.update('task_old', { workRunId: 'run_old' });
    expect(linked?.workRunId).toBe('run_old');

    const foreignKeys = await handle.client.execute('PRAGMA foreign_key_list(tasks)');
    const workRun = foreignKeys.rows.find((row) => row.from === 'work_run_id');
    expect(workRun).toMatchObject({ table: 'runs', on_delete: 'SET NULL' });

    await handle.client.execute({ sql: 'DELETE FROM runs WHERE id = ?', args: ['run_old'] });
    expect((await repos.tasks.get('task_old'))?.workRunId).toBeUndefined();
    expect((await repos.tasks.get('task_old'))?.status).toBe('in_progress');
  });

  it('adds the host browser column in place and leaves existing bots without one', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.slice(0, 5);
    if (applied.length !== 5 || applied[4]?.tag !== '0004_bot_desktop') {
      throw new Error('journal must start with the 0000 to 0004 migrations');
    }

    for (const entry of applied) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of applied) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }
    await handle.client.execute(
      `INSERT INTO bots (id, name, job, instructions, engine, computer, pinned, archived, created_at, updated_at)
       VALUES ('bot_old', 'Ada', 'Researcher', '', 'mock', 'none', 0, 0, '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.000Z')`,
    );

    await migrate(handle.db);

    expect(await columnNames(handle, 'bots')).toContain('browser');
    const repos = createRepos(handle.db);
    expect((await repos.bots.get('bot_old'))?.browser).toBeUndefined();
    expect((await repos.bots.update('bot_old', { browser: true }))?.browser).toBe(true);
    expect((await repos.bots.get('bot_old'))?.browser).toBe(true);
  });

  it('adds teams and the bot team column in place, leaving existing bots ungrouped', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.slice(0, 6);
    if (applied.length !== 6 || applied[5]?.tag !== '0005_flashy_invisible_woman') {
      throw new Error('journal must start with the 0000 to 0005 migrations');
    }

    for (const entry of applied) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of applied) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }
    await handle.client.execute(
      `INSERT INTO bots (id, name, job, instructions, engine, computer, pinned, archived, created_at, updated_at)
       VALUES ('bot_old', 'Ada', 'Researcher', '', 'mock', 'none', 0, 0, '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:00.000Z')`,
    );

    await migrate(handle.db);

    expect(await columnNames(handle, 'bots')).toContain('team_id');
    expect(await tableNames(handle)).toContain('teams');
    const repos = createRepos(handle.db);
    expect((await repos.bots.get('bot_old'))?.teamId).toBeUndefined();

    const team = await repos.teams.create({ name: 'Growth', instructions: 'Ship weekly.' });
    expect((await repos.bots.update('bot_old', { teamId: team.id }))?.teamId).toBe(team.id);
    expect(await repos.teams.remove(team.id)).toBe(true);
    expect((await repos.bots.get('bot_old'))?.teamId).toBeUndefined();
  });

  it('adds routine runs and the catch-up and remember-last-run flags in place', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.slice(0, 7);
    if (applied.length !== 7 || applied[6]?.tag !== '0006_silly_puff_adder') {
      throw new Error('journal must start with the 0000 to 0006 migrations');
    }

    for (const entry of applied) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of applied) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }
    const stamp = '2026-10-19T10:00:00.000Z';
    await handle.client.execute({
      sql: `INSERT INTO bots (id, name, job, instructions, engine, computer, pinned, archived, created_at, updated_at)
            VALUES ('bot_old', 'Ada', 'Researcher', '', 'mock', 'none', 0, 0, ?, ?)`,
      args: [stamp, stamp],
    });
    await handle.client.execute({
      sql: `INSERT INTO routines (id, bot_id, name, instruction, trigger, enabled, created_at, updated_at)
            VALUES ('routine_old', 'bot_old', 'Daily', 'Summarize', '{"type":"cron","cron":"0 9 * * *"}', 1, ?, ?)`,
      args: [stamp, stamp],
    });

    await migrate(handle.db);

    expect(await tableNames(handle)).toContain('routine_runs');
    expect(await columnNames(handle, 'routines')).toEqual(
      expect.arrayContaining(['catch_up', 'remember_last_run']),
    );
    const repos = createRepos(handle.db);
    const routine = await repos.routines.get('routine_old');
    expect(routine).toMatchObject({ name: 'Daily', catchUp: true, rememberLastRun: false });

    const run = await repos.routineRuns.create({
      routineId: 'routine_old',
      botId: 'bot_old',
      threadId: (await repos.threads.create('bot_old', { title: 'Daily' })).id,
      trigger: 'schedule',
      status: 'running',
    });
    expect(run.status).toBe('running');
    expect(await repos.routines.remove('routine_old')).toBe(true);
    expect(await repos.routineRuns.get(run.id)).toBeUndefined();
  });

  it('adds the mcp_servers table in place with its unique name', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.slice(0, 8);
    if (applied.length !== 8 || applied[7]?.tag !== '0007_new_christian_walker') {
      throw new Error('journal must start with the 0000 to 0007 migrations');
    }

    for (const entry of applied) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of applied) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }

    await migrate(handle.db);

    expect(await tableNames(handle)).toContain('mcp_servers');
    expect(await columnNames(handle, 'mcp_servers')).toEqual([
      'id',
      'name',
      'transport',
      'command',
      'args',
      'env',
      'url',
      'enabled',
      'created_at',
      'updated_at',
    ]);
    const indexes = await handle.client.execute("PRAGMA index_list('mcp_servers')");
    expect(indexes.rows.some((row) => row.name === 'mcp_servers_name_uq' && Number(row.unique) === 1)).toBe(true);

    const repos = createRepos(handle.db);
    const server = await repos.mcpServers.create({ name: 'tools', command: 'npx' });
    expect((await repos.mcpServers.get(server.id))?.name).toBe('tools');
  });

  it('adds the attachments table in place, linked to its thread and message', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.slice(0, 9);
    if (applied.length !== 9 || applied[8]?.tag !== '0008_smooth_puma') {
      throw new Error('journal must start with the 0000 to 0008 migrations');
    }

    for (const entry of applied) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of applied) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }

    await migrate(handle.db);

    expect(await tableNames(handle)).toContain('attachments');
    expect(await columnNames(handle, 'attachments')).toEqual([
      'id',
      'thread_id',
      'message_id',
      'name',
      'mime_type',
      'size',
      'sha256',
      'created_at',
    ]);
    const indexes = await handle.client.execute("PRAGMA index_list('attachments')");
    expect(indexes.rows.some((row) => row.name === 'attachments_thread_idx')).toBe(true);
    expect(indexes.rows.some((row) => row.name === 'attachments_message_idx')).toBe(true);

    const repos = createRepos(handle.db);
    const bot = await repos.bots.create({ name: 'Ada', job: 'x' });
    const thread = await repos.threads.create(bot.id);
    const attachment = await repos.attachments.create({
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 5,
      sha256: 'a'.repeat(64),
      threadId: thread.id,
    });
    const message = await repos.messages.create({ threadId: thread.id, role: 'user', content: 'See notes' });
    await repos.attachments.linkToMessage([attachment.id], message.id);
    expect((await repos.messages.get(message.id))?.attachments).toEqual([{ ...attachment, messageId: message.id }]);
  });

  it('adds notifications and the bot notification toggle in place', async () => {
    const { handle } = await tempDb();
    const journal = JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const applied = journal.entries.slice(0, 10);
    if (applied.length !== 10 || applied[9]?.tag !== '0009_confused_anthem') {
      throw new Error('journal must start with the 0000 to 0009 migrations');
    }

    for (const entry of applied) {
      await handle.client.executeMultiple(await readFile(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'));
    }
    await handle.client.execute(
      'CREATE TABLE "__drizzle_migrations" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "hash" text NOT NULL, "created_at" numeric)',
    );
    for (const entry of applied) {
      await handle.client.execute({
        sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
        args: [entry.tag, entry.when],
      });
    }
    const stamp = '2026-10-19T10:00:00.000Z';
    await handle.client.execute({
      sql: `INSERT INTO bots (id, name, job, instructions, engine, computer, pinned, archived, created_at, updated_at)
            VALUES ('bot_old', 'Ada', 'Researcher', '', 'mock', 'none', 0, 0, ?, ?)`,
      args: [stamp, stamp],
    });
    await handle.client.execute({
      sql: `INSERT INTO threads (id, bot_id, title, kind, created_at, updated_at)
            VALUES ('thread_old', 'bot_old', 'Chat', 'dm', ?, ?)`,
      args: [stamp, stamp],
    });

    await migrate(handle.db);

    expect(await tableNames(handle)).toContain('notifications');
    expect(await columnNames(handle, 'notifications')).toEqual([
      'id',
      'bot_id',
      'thread_id',
      'kind',
      'title',
      'body',
      'created_at',
      'read_at',
    ]);
    const indexes = await handle.client.execute("PRAGMA index_list('notifications')");
    expect(indexes.rows.some((row) => row.name === 'notifications_read_idx')).toBe(true);
    expect(indexes.rows.some((row) => row.name === 'notifications_bot_idx')).toBe(true);

    const repos = createRepos(handle.db);
    expect((await repos.bots.get('bot_old'))?.notifications).toBeUndefined();
    expect(await repos.notifications.create({
      botId: 'bot_old',
      threadId: 'thread_old',
      kind: 'finished',
      title: '"Ada" finished',
      body: 'Done.',
    })).toMatchObject({ kind: 'finished', title: '"Ada" finished' });
  });

  it('enables foreign keys on the connection', async () => {
    const { handle } = await tempDb();

    const result = await handle.client.execute('PRAGMA foreign_keys');
    expect(Number(result.rows[0]?.foreign_keys)).toBe(1);
  });

  it('persists data in a file database across reconnects', async () => {
    const { handle, url } = await tempDb();
    await migrate(handle.db);
    const created = await createRepos(handle.db).bots.create({ name: 'Ada', job: 'Researcher' });
    handle.client.close();

    const second = await createDb(url);
    open.push(second);
    await migrate(second.db);
    expect(await createRepos(second.db).bots.get(created.id)).toEqual(created);
  });
});
