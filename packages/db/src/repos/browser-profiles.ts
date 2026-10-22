import { asc, eq } from 'drizzle-orm';
import {
  CreateBrowserProfile,
  UpdateBrowserProfile,
  type BrowserProfile,
  type CreateBrowserProfile as CreateBrowserProfileInput,
} from '@brot/protocol';
import type { Db } from '../client';
import { bots, browserProfiles } from '../schema';
import { newId, nowIso, required } from './common';

type BrowserProfileRow = typeof browserProfiles.$inferSelect;

export function toBrowserProfile(row: BrowserProfileRow): BrowserProfile {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createBrowserProfileRepo(db: Db) {
  return {
    /** Every shared browser profile, by name. */
    async list(): Promise<BrowserProfile[]> {
      const rows = await db.select().from(browserProfiles).orderBy(asc(browserProfiles.name), asc(browserProfiles.id));
      return rows.map(toBrowserProfile);
    },

    async get(id: string): Promise<BrowserProfile | undefined> {
      const [row] = await db.select().from(browserProfiles).where(eq(browserProfiles.id, id)).limit(1);
      return row ? toBrowserProfile(row) : undefined;
    },

    async create(input: CreateBrowserProfileInput): Promise<BrowserProfile> {
      const data = CreateBrowserProfile.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(browserProfiles)
        .values({ ...data, id: newId(), createdAt: timestamp, updatedAt: timestamp })
        .returning();
      return toBrowserProfile(required(row, 'browser profile'));
    },

    async update(id: string, input: UpdateBrowserProfile): Promise<BrowserProfile | undefined> {
      const patch = UpdateBrowserProfile.parse(input);
      const rows = await db
        .update(browserProfiles)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(browserProfiles.id, id))
        .returning();
      return rows[0] ? toBrowserProfile(rows[0]) : undefined;
    },

    /** Deletes the profile and ungroups its bots, which fall back to their own profiles. Never deletes a bot. */
    async remove(id: string): Promise<boolean> {
      const timestamp = nowIso();
      await db.update(bots).set({ browserProfileId: null, updatedAt: timestamp }).where(eq(bots.browserProfileId, id));
      const rows = await db.delete(browserProfiles).where(eq(browserProfiles.id, id)).returning({ id: browserProfiles.id });
      return rows.length > 0;
    },
  };
}
