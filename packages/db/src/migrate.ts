import { fileURLToPath } from 'node:url';
import { migrate as runMigrations } from 'drizzle-orm/libsql/migrator';
import type { Db } from './client';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies every pending migration. Already-applied migrations are skipped, so calling this repeatedly is safe. */
export async function migrate(db: Db): Promise<void> {
  await runMigrations(db, { migrationsFolder });
}
