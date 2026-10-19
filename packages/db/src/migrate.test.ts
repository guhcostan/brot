import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrate, type BrotDb } from './index';
import { createRepos } from './repos';

const open: BrotDb[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const { client } of open.splice(0)) client.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tableNames(handle: BrotDb): Promise<string[]> {
  const result = await handle.client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

describe('migrate', () => {
  it('creates every table and can run twice', async () => {
    const handle = await createDb(':memory:');
    open.push(handle);

    await migrate(handle.db);
    await migrate(handle.db);

    expect(await tableNames(handle)).toEqual([
      '__drizzle_migrations',
      'approvals',
      'bots',
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
    expect(Number(applied.rows[0]?.count)).toBe(1);
  });

  it('enables foreign keys on the connection', async () => {
    const handle = await createDb(':memory:');
    open.push(handle);

    const result = await handle.client.execute('PRAGMA foreign_keys');
    expect(Number(result.rows[0]?.foreign_keys)).toBe(1);
  });

  it('persists data in a file database across reconnects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brot-db-test-'));
    dirs.push(dir);
    const url = `file:${join(dir, 'brot.db')}`;

    const first = await createDb(url);
    await migrate(first.db);
    const created = await createRepos(first.db).bots.create({ name: 'Ada', job: 'Researcher' });
    first.client.close();

    const second = await createDb(url);
    open.push(second);
    await migrate(second.db);
    expect(await createRepos(second.db).bots.get(created.id)).toEqual(created);
  });
});
