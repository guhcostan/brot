import type { CanonicalEvent, Task, TaskStatus } from '@brot/protocol';
import { t } from '../i18n';

/** Board columns in work order. Finished states sit last. */
export const TASK_COLUMNS: readonly TaskStatus[] = ['in_progress', 'blocked', 'open', 'done', 'failed', 'cancelled'];

const ACTIVE: ReadonlySet<TaskStatus> = new Set(['open', 'in_progress', 'blocked']);

export function isActiveTask(task: Pick<Task, 'status'>): boolean {
  return ACTIVE.has(task.status);
}

export function taskStatusLabel(status: TaskStatus): string {
  return t(`tasks.status.${status}`);
}

const ts = (iso: string) => Date.parse(iso);

/** Applies a live task event to a fetched list: replaces the task by id or adds it. */
export function applyTaskEvent(tasks: readonly Task[], event: CanonicalEvent): Task[] {
  if (event.type !== 'task.created' && event.type !== 'task.updated') return [...tasks];
  const current = tasks.find((task) => task.id === event.task.id);
  if (current && ts(current.updatedAt) > ts(event.task.updatedAt)) return [...tasks];
  return [...tasks.filter((task) => task.id !== event.task.id), event.task];
}

export interface TaskColumn {
  status: TaskStatus;
  tasks: Task[];
}

/** Tasks grouped by status, newest change first inside a column; empty columns left out. */
export function taskColumns(tasks: readonly Task[], filter: 'active' | 'all' = 'all'): TaskColumn[] {
  return TASK_COLUMNS.filter((status) => filter === 'all' || ACTIVE.has(status))
    .map((status) => ({
      status,
      tasks: tasks.filter((task) => task.status === status).sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt)),
    }))
    .filter((column) => column.tasks.length > 0);
}
