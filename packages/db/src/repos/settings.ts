import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { settings } from '../schema';
import { nowIso } from './common';

/**
 * Anything with a zod-like `parse`. A zod schema satisfies it, so callers own the value's shape and the db
 * package needs no schema library of its own.
 */
export interface SettingsValueParser<T> {
  parse(value: unknown): T;
}

/** Server settings in one key-value table. A value is stored as JSON and read back through its owning schema. */
export function createSettingsRepo(db: Db) {
  return {
    /** The parsed value, or undefined when the key is missing or the stored JSON no longer parses. */
    async get<T>(key: string, schema: SettingsValueParser<T>): Promise<T | undefined> {
      const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
      if (row === undefined) return undefined;
      try {
        return schema.parse(row.value);
      } catch {
        return undefined;
      }
    },

    /** Writes the value as JSON, replacing any previous one. */
    async set<T>(key: string, value: T): Promise<void> {
      const updatedAt = nowIso();
      await db
        .insert(settings)
        .values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } });
    },

    async remove(key: string): Promise<boolean> {
      const rows = await db.delete(settings).where(eq(settings.key, key)).returning({ key: settings.key });
      return rows.length > 0;
    },
  };
}
