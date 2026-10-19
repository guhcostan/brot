import { createClient, type Client, type Transaction, type TransactionMode } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type Db = LibSQLDatabase<typeof schema>;

export interface BrotDb {
  db: Db;
  client: Client;
}

/**
 * How long a connection waits for a lock held by another process before it fails with SQLITE_BUSY.
 * `timeout` applies it to every connection the client opens, which a PRAGMA on one connection would not.
 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens a libSQL database. `url` is a libSQL URL such as `file:/abs/path/brot.db` or `:memory:`.
 * Foreign keys are enabled on the connection so that cascading deletes take effect.
 *
 * File databases use WAL, so readers do not block the writer. @libsql/client 0.18 starts every transaction
 * with BEGIN IMMEDIATE (its default mode is "write"), and drizzle-orm 0.45 does not pass a transaction
 * behavior through, so `db.transaction(fn, { behavior })` changes nothing. Within this process, calls are
 * serialized (see `gateClient`), so a transaction never waits on a write from the same process.
 */
export async function createDb(url: string): Promise<BrotDb> {
  const client = gateClient(createClient({ url, timeout: BUSY_TIMEOUT_MS }));
  await client.execute('PRAGMA foreign_keys = ON');
  if (!url.includes(':memory:')) {
    await client.execute('PRAGMA journal_mode = WAL');
  }
  const db = drizzle(client, { schema });
  return { db, client };
}

/**
 * One operation at a time. A caller waits for the operation ahead of it, and a transaction holds the gate
 * from `transaction()` until it commits, rolls back, or closes.
 */
class Gate {
  #busy = false;
  readonly #waiting: Array<() => void> = [];

  async enter(): Promise<() => void> {
    if (this.#busy) await new Promise<void>((resume) => this.#waiting.push(resume));
    this.#busy = true;
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const next = this.#waiting.shift();
      if (next) next();
      else this.#busy = false;
    };
  }
}

const GATED_METHODS = new Set(['execute', 'batch', 'migrate', 'executeMultiple']);

/**
 * Serializes this process's use of the client. @libsql/client runs each statement synchronously on a pooled
 * connection, so a statement that hits another connection's write lock blocks the thread in SQLite's busy
 * handler. The transaction holding that lock is on the same thread and cannot resume, so the statement fails
 * after the busy timeout. Gating makes a write issued during a transaction wait for the transaction instead.
 *
 * Inside a transaction callback, use the `tx` argument only. A call through the outer client waits for the
 * transaction that is waiting for it, and never returns.
 */
function gateClient(client: Client): Client {
  const gate = new Gate();
  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop === 'transaction') {
        return async (mode?: TransactionMode): Promise<Transaction> => {
          const leave = await gate.enter();
          try {
            return gateTransaction(await target.transaction(mode), leave);
          } catch (error) {
            leave();
            throw error;
          }
        };
      }
      const method = value as (...args: unknown[]) => Promise<unknown>;
      if (typeof prop === 'string' && GATED_METHODS.has(prop)) {
        return async (...args: unknown[]) => {
          const leave = await gate.enter();
          try {
            return await method.apply(target, args);
          } finally {
            leave();
          }
        };
      }
      return method.bind(target);
    },
  }) as Client;
}

/** Keeps the gate held until the transaction ends. `close` ends a transaction that was never settled. */
function gateTransaction(tx: Transaction, leave: () => void): Transaction {
  return new Proxy(tx, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (prop === 'commit' || prop === 'rollback') {
        const settle = value as () => Promise<void>;
        return async () => {
          try {
            await settle.call(target);
          } finally {
            leave();
          }
        };
      }
      if (prop === 'close') {
        const close = value as () => void;
        return () => {
          try {
            close.call(target);
          } finally {
            leave();
          }
        };
      }
      return (value as (...args: unknown[]) => unknown).bind(target);
    },
  }) as Transaction;
}
