import type { Task } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { at, event } from '../testing';
import { applyTaskEvent, taskColumns } from './tasks';

function task(patch: Partial<Task> & { id: string }): Task {
  return {
    title: patch.id,
    status: 'open',
    assigneeBotId: 'b1',
    createdByUser: true,
    threadId: 'th1',
    chainId: patch.id,
    depth: 0,
    createdAt: at(0),
    updatedAt: at(0),
    ...patch,
  };
}

describe('task board', () => {
  it('groups by status in work order, newest first, and filters to active', () => {
    const tasks = [
      task({ id: 'a', status: 'done', updatedAt: at(5) }),
      task({ id: 'b', status: 'in_progress', updatedAt: at(1) }),
      task({ id: 'c', status: 'in_progress', updatedAt: at(3) }),
      task({ id: 'd', status: 'open' }),
    ];
    expect(taskColumns(tasks).map((column) => [column.status, column.tasks.map((t) => t.id)])).toEqual([
      ['in_progress', ['c', 'b']],
      ['open', ['d']],
      ['done', ['a']],
    ]);
    expect(taskColumns(tasks, 'active').map((column) => column.status)).toEqual(['in_progress', 'open']);
  });

  it('applies live events and ignores stale ones', () => {
    const start = [task({ id: 'a', updatedAt: at(5) })];
    const added = applyTaskEvent(start, event({ type: 'task.created', task: task({ id: 'b' }) }));
    expect(added.map((t) => t.id)).toEqual(['a', 'b']);
    const stale = applyTaskEvent(added, event({ type: 'task.updated', task: task({ id: 'a', status: 'done', updatedAt: at(1) }) }));
    expect(stale.find((t) => t.id === 'a')?.status).toBe('open');
    const fresh = applyTaskEvent(added, event({ type: 'task.updated', task: task({ id: 'a', status: 'done', updatedAt: at(9) }) }));
    expect(fresh.find((t) => t.id === 'a')?.status).toBe('done');
  });
});
