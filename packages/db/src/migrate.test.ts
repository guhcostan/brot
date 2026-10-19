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
      'bots',
      'computers',
      'devices',
      'events',
      'memories',
      'messages',
      'policies',
      'routines',
      'runs',
      'skills',
      'threads',
    ]);

    const applied = await handle.client.execute('SELECT COUNT(*) AS count FROM __drizzle_migrations');
    expect(Number(applied.rows[0]?.count)).toBe(2);
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
