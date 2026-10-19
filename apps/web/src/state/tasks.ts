import type { Task, TaskStatus } from '@brot/protocol';

/** Board columns, in work order. Cancelled tasks get their own group only when there are any. */
export const BOARD_COLUMNS: readonly TaskStatus[] = ['open', 'in_progress', 'blocked', 'done', 'failed'];

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['done', 'failed', 'cancelled']);

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

type TaskIndex = Readonly<Record<string, Task>>;

/** The task's ancestors, root first. Stops at a missing parent or a cycle. */
export function ancestorsOf(tasks: TaskIndex, task: Task): Task[] {
  const chain: Task[] = [];
  const seen = new Set<string>([task.id]);
  let parentId = task.parentTaskId;
  while (parentId !== undefined && !seen.has(parentId)) {
    const parent = tasks[parentId];
    if (!parent) break;
    seen.add(parent.id);
    chain.unshift(parent);
    parentId = parent.parentTaskId;
  }
  return chain;
}

export function childrenOf(tasks: TaskIndex, taskId: string): Task[] {
  return Object.values(tasks)
    .filter((task) => task.parentTaskId === taskId)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Tasks a bot is assigned or delegated, newest activity first. */
export function tasksForBot(tasks: TaskIndex, botId: string): Task[] {
  return byRecent(Object.values(tasks).filter((task) => task.assigneeBotId === botId || task.createdByBotId === botId));
}

/** Tasks requested in a room, plus every task in the same chains, wherever it was delegated. */
export function tasksForRoom(tasks: TaskIndex, roomId: string): Task[] {
  const all = Object.values(tasks);
  const chains = new Set(all.filter((task) => task.threadId === roomId).map((task) => task.chainId));
  return byRecent(all.filter((task) => task.threadId === roomId || chains.has(task.chainId)));
}

export function groupByStatus(list: readonly Task[]): Record<TaskStatus, Task[]> {
  const groups: Record<TaskStatus, Task[]> = {
    open: [],
    in_progress: [],
    blocked: [],
    done: [],
    failed: [],
    cancelled: [],
  };
  for (const task of list) groups[task.status].push(task);
  return groups;
}

function byRecent(list: Task[]): Task[] {
  return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
