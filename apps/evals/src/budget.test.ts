import { describe, expect, it } from 'vitest';
import type { CanonicalEvent, Run, Task } from '@brot/protocol';
import { budgetVerdict, cancelCaseWork, CostWatch, startBudgetGuard, type BudgetApi } from './budget';

const costEvent = (id: string, runId: string, costUsd: number): CanonicalEvent =>
  ({
    id,
    type: 'cost.updated',
    at: '2026-10-19T10:00:00.000Z',
    threadId: 'thread-1',
    runId,
    tokensIn: 10,
    tokensOut: 5,
    costUsd,
  }) as CanonicalEvent;

/** A thread's event log that grows: `after` returns the events past that id, as the server does. */
function logOf(events: CanonicalEvent[]) {
  const reads: Array<string | undefined> = [];
  return {
    reads,
    async threadEventsAfter(_threadId: string, after: string | undefined): Promise<CanonicalEvent[]> {
      reads.push(after);
      if (after === undefined) return [...events];
      const index = events.findIndex((event) => event.id === after);
      return index < 0 ? [] : events.slice(index + 1);
    },
  };
}

describe('budgetVerdict', () => {
  const limits = { caseUsd: 1.5, totalUsd: 5, spentBeforeUsd: 4 };

  it('lets a case run while both budgets hold', () => {
    expect(budgetVerdict(1.5, { ...limits, spentBeforeUsd: 3 })).toBeUndefined();
  });

  it('stops a case that spends over its own cap, whatever the run has left', () => {
    expect(budgetVerdict(1.51, { ...limits, spentBeforeUsd: 0 })).toMatch(/per-case cap \(--max-case-usd\)/);
  });

  it('stops a case that takes the whole run over the run cap, even under its own cap', () => {
    expect(budgetVerdict(1.2, limits)).toMatch(/the run spent \$5\.2000 in total, over the \$5 cap \(--max-usd\)/);
  });
});

describe('CostWatch', () => {
  it('sums the last cost.updated of each run, so running totals are not double counted', async () => {
    const log = logOf([costEvent('e1', 'run-a', 0.2), costEvent('e2', 'run-a', 0.5), costEvent('e3', 'run-b', 0.3)]);
    const watch = new CostWatch(log);
    expect(await watch.poll(['thread-1'])).toBeCloseTo(0.8, 6);
  });

  it('reads only the events it has not seen, using the last id as the cursor', async () => {
    const events = [costEvent('e1', 'run-a', 0.2)];
    const log = logOf(events);
    const watch = new CostWatch(log);
    await watch.poll(['thread-1']);
    events.push(costEvent('e2', 'run-a', 0.9));
    expect(await watch.poll(['thread-1'])).toBeCloseTo(0.9, 6);
    expect(log.reads).toEqual([undefined, 'e1']);
  });

  it('ignores events that are not valid protocol events', async () => {
    const log = logOf([{ id: 'junk', type: 'nonsense' } as unknown as CanonicalEvent, costEvent('e1', 'run-a', 0.4)]);
    expect(await new CostWatch(log).poll(['thread-1'])).toBeCloseTo(0.4, 6);
  });
});

/** A case's work and its event log: runs and tasks that the fake records cancels against. */
function fakeWork(runs: Array<Partial<Run>>, tasks: Array<Partial<Task>>, events: CanonicalEvent[] = []) {
  const cancelled: string[] = [];
  const patched: Array<{ id: string; status: string }> = [];
  const log = logOf(events);
  const api: BudgetApi = {
    threadEventsAfter: log.threadEventsAfter,
    async listRuns(): Promise<Run[]> {
      return runs as Run[];
    },
    async cancelRun(id: string): Promise<Run> {
      cancelled.push(id);
      return {} as Run;
    },
    async listTasks(query: { assigneeBotId?: string; threadId?: string }): Promise<Task[]> {
      return tasks.filter((task) => query.assigneeBotId === undefined || task.assigneeBotId === query.assigneeBotId) as Task[];
    },
    async patchTask(id: string, status: string): Promise<Task> {
      patched.push({ id, status });
      return {} as Task;
    },
  };
  return { api, cancelled, patched };
}

describe('cancelCaseWork', () => {
  it('cancels only the runs still going and the tasks still open', async () => {
    const work = fakeWork(
      [
        { id: 'run-running', status: 'running' },
        { id: 'run-waiting', status: 'waiting_approval' },
        { id: 'run-done', status: 'completed' },
      ],
      [
        { id: 'task-open', assigneeBotId: 'bot-1', status: 'open' },
        { id: 'task-done', assigneeBotId: 'bot-1', status: 'done' },
      ],
    );
    const counts = await cancelCaseWork(work.api, { threadIds: async () => ['thread-1'], botIds: () => ['bot-1'] });
    expect(work.cancelled).toEqual(['run-running', 'run-waiting']);
    expect(work.patched).toEqual([{ id: 'task-open', status: 'cancelled' }]);
    expect(counts).toEqual({ runs: 2, tasks: 1 });
  });
});

describe('startBudgetGuard', () => {
  it('reports the stop once the case crosses its cap, and cancels its work', async () => {
    const work = fakeWork(
      [{ id: 'run-a', status: 'running' }],
      [{ id: 'task-1', assigneeBotId: 'bot-1', status: 'in_progress' }],
      [costEvent('e1', 'run-a', 2)],
    );
    const stops: string[] = [];
    const lines: string[] = [];
    const guard = startBudgetGuard({
      api: work.api,
      limits: { caseUsd: 1.5, totalUsd: 5, spentBeforeUsd: 0 },
      pollMs: 1,
      targets: { threadIds: async () => ['thread-1'], botIds: () => ['bot-1'] },
      onStop: (reason) => stops.push(reason),
      log: (line) => lines.push(line),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await guard.stop();
    expect(guard.costUsd()).toBeCloseTo(2, 6);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatch(/per-case cap/);
    expect(lines).toEqual(stops);
    expect(work.cancelled).toContain('run-a');
    expect(work.patched).toContainEqual({ id: 'task-1', status: 'cancelled' });
  });

  it('stays quiet while the case is inside both budgets', async () => {
    const work = fakeWork([{ id: 'run-a', status: 'running' }], [], [costEvent('e1', 'run-a', 0.1)]);
    const stops: string[] = [];
    const guard = startBudgetGuard({
      api: work.api,
      limits: { caseUsd: 1.5, totalUsd: 5, spentBeforeUsd: 1 },
      pollMs: 1,
      targets: { threadIds: async () => ['thread-1'], botIds: () => ['bot-1'] },
      onStop: (reason) => stops.push(reason),
      log: () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await guard.stop();
    expect(stops).toEqual([]);
    expect(work.cancelled).toEqual([]);
  });
});
