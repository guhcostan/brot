import { asc, eq } from 'drizzle-orm';
import {
  CreateSavedLogin,
  UpdateSavedLogin,
  type CreateSavedLogin as CreateSavedLoginInput,
  type SavedLogin,
} from '@brot/protocol';
import type { Db } from '../client';
import { savedLogins } from '../schema';
import { nowIso, required } from './common';

type SavedLoginRow = typeof savedLogins.$inferSelect;

/** The vault secret names holding one login's values. The row stores these names; the values stay in the vault. */
export interface SavedLoginSecretNames {
  username: string;
  password: string;
  totp: string;
}

export interface CreateSavedLoginOptions {
  /** Pre-assigned id, so the caller can derive the vault names before the row exists. */
  id: string;
  secretNames: SavedLoginSecretNames;
}

export function toSavedLogin(row: SavedLoginRow): SavedLogin {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    ...(row.label === null ? {} : { label: row.label }),
    hasTotp: row.totpSecret !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSavedLoginRepo(db: Db) {
  return {
    /** Every saved login, by name. */
    async list(): Promise<SavedLogin[]> {
      const rows = await db.select().from(savedLogins).orderBy(asc(savedLogins.name), asc(savedLogins.id));
      return rows.map(toSavedLogin);
    },

    async get(id: string): Promise<SavedLogin | undefined> {
      const [row] = await db.select().from(savedLogins).where(eq(savedLogins.id, id)).limit(1);
      return row ? toSavedLogin(row) : undefined;
    },

    async getByName(name: string): Promise<SavedLogin | undefined> {
      const [row] = await db.select().from(savedLogins).where(eq(savedLogins.name, name)).limit(1);
      return row ? toSavedLogin(row) : undefined;
    },

    async create(input: CreateSavedLoginInput, options: CreateSavedLoginOptions): Promise<SavedLogin> {
      const data = CreateSavedLogin.parse(input);
      const timestamp = nowIso();
      const [row] = await db
        .insert(savedLogins)
        .values({
          id: options.id,
          name: data.name,
          host: data.host,
          label: data.label ?? null,
          usernameSecret: options.secretNames.username,
          passwordSecret: options.secretNames.password,
          totpSecret: data.totp === undefined ? null : options.secretNames.totp,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      return toSavedLogin(required(row, 'saved login'));
    },

    /** Applies the patch. Re-sent values keep their deterministic secret names; `totp: null` drops two-factor. */
    async update(id: string, input: UpdateSavedLogin, secretNames: SavedLoginSecretNames): Promise<SavedLogin | undefined> {
      const patch = UpdateSavedLogin.parse(input);
      const values: {
        updatedAt: string;
        name?: string;
        host?: string;
        label?: string | null;
        usernameSecret?: string;
        passwordSecret?: string;
        totpSecret?: string | null;
      } = { updatedAt: nowIso() };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.host !== undefined) values.host = patch.host;
      if (patch.label !== undefined) values.label = patch.label;
      if (patch.username !== undefined) values.usernameSecret = secretNames.username;
      if (patch.password !== undefined) values.passwordSecret = secretNames.password;
      if (patch.totp !== undefined) values.totpSecret = patch.totp === null ? null : secretNames.totp;
      const rows = await db.update(savedLogins).set(values).where(eq(savedLogins.id, id)).returning();
      return rows[0] ? toSavedLogin(rows[0]) : undefined;
    },

    /** Removes the row. The caller deletes the vault values; the repository never touches them. */
    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(savedLogins).where(eq(savedLogins.id, id)).returning({ id: savedLogins.id });
      return rows.length > 0;
    },
  };
}
