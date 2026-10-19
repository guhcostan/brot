import { and, asc, count, eq } from 'drizzle-orm';
import {
  CreateTask,
  TEAM_MAX_DEPTH,
  TEAM_MAX_TASKS_PER_CHAIN,
  UpdateTask,
  type CreateTaskInput,
  type Task,
  type TaskStatus,
} from '@brot/protocol';
import type { Db } from '../client';
import { tasks } from '../schema';
import { newId, nowIso, required } from './common';

type TaskRow = typeof tasks.$inferSelect;

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status,
    assigneeBotId: row.assigneeBotId,
    createdByBotId: row.createdByBotId ?? undefined,
    createdByUser: row.createdByUser,
    parentTaskId: row.parentTaskId ?? undefined,
    threadId: row.threadId,
    workThreadId: row.workThreadId ?? undefined,
    workRunId: row.workRunId ?? undefined,
    result: row.result ?? undefined,
    chainId: row.chainId,
    depth: row.depth,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface TaskFilter {
  assigneeBotId?: string;
  status?: TaskStatus;
  chainId?: string;
  threadId?: string;
}

export function createTaskRepo(db: Db) {
  return {
    async get(id: string): Promise<Task | undefined> {
      const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      return row ? toTask(row) : undefined;
    },

    /** Tasks matching every given filter, oldest first. */
    async list(filter: TaskFilter = {}): Promise<Task[]> {
      const rows = await db
        .select()
        .from(tasks)
        .where(
          and(
            filter.assigneeBotId ? eq(tasks.assigneeBotId, filter.assigneeBotId) : undefined,
            filter.status ? eq(tasks.status, filter.status) : undefined,
            filter.chainId ? eq(tasks.chainId, filter.chainId) : undefined,
            filter.threadId ? eq(tasks.threadId, filter.threadId) : undefined,
          ),
        )
        .orderBy(asc(tasks.createdAt), asc(tasks.id));
      return rows.map(toTask);
    },

    /** Tasks delegated under `parentTaskId`, oldest first. */
    async listChildren(parentTaskId: string): Promise<Task[]> {
      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.parentTaskId, parentTaskId))
        .orderBy(asc(tasks.createdAt), asc(tasks.id));
      return rows.map(toTask);
    },

    /**
     * Creates a task in `open` status and places it in a chain.
     * - A user-created task (no `createdByBotId`) is depth 0 and starts a chain with its own id.
     * - A delegation under a parent is `parent.depth + 1`, in the parent's chain.
     * - A delegation with no parent is depth 1 and starts a chain with its own id.
     *
     * Throws, and creates nothing, when the parent does not exist, when the depth would pass
     * `TEAM_MAX_DEPTH`, or when the chain already holds `TEAM_MAX_TASKS_PER_CHAIN` tasks.
     */
    async create(input: CreateTaskInput): Promise<Task> {
      const data = CreateTask.parse(input);
      const id = newId();
      const timestamp = nowIso();
      return db.transaction(async (tx) => {
        let depth = data.createdByBotId === undefined ? 0 : 1;
        let chainId = id;
        if (data.parentTaskId !== undefined) {
          const [parent] = await tx.select().from(tasks).where(eq(tasks.id, data.parentTaskId)).limit(1);
          if (!parent) throw new Error(`parent task ${data.parentTaskId} does not exist`);
          depth = parent.depth + 1;
          chainId = parent.chainId;

          const [tally] = await tx.select({ total: count() }).from(tasks).where(eq(tasks.chainId, chainId));
          if ((tally?.total ?? 0) >= TEAM_MAX_TASKS_PER_CHAIN) {
            throw new Error(`chain ${chainId} already holds ${TEAM_MAX_TASKS_PER_CHAIN} tasks`);
          }
        }
        if (depth > TEAM_MAX_DEPTH) {
          throw new Error(`a task may be at most depth ${TEAM_MAX_DEPTH}, not ${depth}`);
        }

        const [row] = await tx
          .insert(tasks)
          .values({
            id,
            title: data.title,
            description: data.description ?? null,
            status: 'open',
            assigneeBotId: data.assigneeBotId,
            createdByBotId: data.createdByBotId ?? null,
            createdByUser: data.createdByBotId === undefined,
            parentTaskId: data.parentTaskId ?? null,
            threadId: data.threadId,
            workThreadId: null,
            result: null,
            chainId,
            depth,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
        return toTask(required(row, 'task'));
      });
    },

    /** Updates status, result, assignee, or work thread, and bumps `updatedAt`. Undefined for an unknown task. */
    async update(id: string, input: UpdateTask): Promise<Task | undefined> {
      const patch = UpdateTask.parse(input);
      const rows = await db
        .update(tasks)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(tasks.id, id))
        .returning();
      return rows[0] ? toTask(rows[0]) : undefined;
    },
  };
}
