import { asc, eq } from 'drizzle-orm';
import { DeviceRole, type Device } from '@brot/protocol';
import type { Db } from '../client';
import { devices } from '../schema';
import { newId, nowIso, required } from './common';

type DeviceRow = typeof devices.$inferSelect;

export interface CreateDeviceInput {
  name: string;
  role: Device['role'];
  publicKey: string;
  /** SHA-256 (or similar) of the device token. The raw token is never stored. */
  tokenHash: string;
}

/** Device rows without the token hash, which never leaves the database layer. */
export function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    publicKey: row.publicKey,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt ?? undefined,
  };
}

export function createDeviceRepo(db: Db) {
  const get = async (id: string): Promise<Device | undefined> => {
    const [row] = await db.select().from(devices).where(eq(devices.id, id)).limit(1);
    return row ? toDevice(row) : undefined;
  };

  return {
    get,

    async list(): Promise<Device[]> {
      const rows = await db.select().from(devices).orderBy(asc(devices.createdAt), asc(devices.id));
      return rows.map(toDevice);
    },

    async create(input: CreateDeviceInput): Promise<Device> {
      const role = DeviceRole.parse(input.role);
      const [row] = await db
        .insert(devices)
        .values({
          id: newId(),
          name: input.name,
          role,
          publicKey: input.publicKey,
          tokenHash: input.tokenHash,
          createdAt: nowIso(),
        })
        .returning();
      return toDevice(required(row, 'device'));
    },

    async findByTokenHash(tokenHash: string): Promise<Device | undefined> {
      const [row] = await db.select().from(devices).where(eq(devices.tokenHash, tokenHash)).limit(1);
      return row ? toDevice(row) : undefined;
    },

    async touch(id: string): Promise<Device | undefined> {
      const rows = await db
        .update(devices)
        .set({ lastSeenAt: nowIso() })
        .where(eq(devices.id, id))
        .returning();
      return rows[0] ? toDevice(rows[0]) : undefined;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(devices).where(eq(devices.id, id)).returning({ id: devices.id });
      return rows.length > 0;
    },
  };
}
