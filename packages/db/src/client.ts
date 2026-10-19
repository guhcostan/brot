import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Db = LibSQLDatabase<typeof schema>;

export interface BrotDb {
  db: Db;
  client: Client;
}

/**
 * Opens a libSQL database. `url` is a libSQL URL such as `file:/abs/path/brot.db` or `:memory:`.
 * Foreign keys are enabled on the connection so that cascading deletes take effect.
 */
export async function createDb(url: string): Promise<BrotDb> {
  const client = createClient({ url });
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  return { db, client };
}
