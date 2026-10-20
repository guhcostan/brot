import { CanonicalEvent, type Run, type Task } from '@brot/protocol';
import type { BrotApi } from './api';
import { errorMessage, sleep } from './util';

export interface BudgetLimits {
  /** Spend allowed for one case, from `--max-case-usd`. */
  caseUsd: number;
  /** Spend allowed for the whole run, from `--max-usd`. */
  totalUsd: number;
  /** What the earlier cases of this run already spent. */
  spentBeforeUsd: number;
}

type EventSource = Pick<BrotApi, 'threadEventsAfter'>;
/** The calls the guard makes: reads of the event log, and cancels of runs and tasks. */
export type BudgetApi = EventSource & Pick<BrotApi, 'listRuns' | 'cancelRun' | 'listTasks' | 'patchTask'>;

/**
 * The running cost of a case, read from the `cost.updated` events of its threads. Each event carries the run's running
 * total, so the last event per run wins. Reads are incremental: each thread keeps a cursor at the last event it saw.
 */
export class CostWatch {
  private readonly cursors = new Map<string, string>();
  private readonly runTotals = new Map<string, number>();

  constructor(private readonly api: EventSource) {}

  /** Reads what is new on every thread and returns the case's cost so far. */
  async poll(threadIds: readonly string[]): Promise<number> {
    for (const threadId of threadIds) {
      const fresh = await this.api.threadEventsAfter(threadId, this.cursors.get(threadId));
      for (const raw of fresh) {
        this.cursors.set(threadId, raw.id);
        const parsed = CanonicalEvent.safeParse(raw);
        if (parsed.success && parsed.data.type === 'cost.updated' && parsed.data.runId !== undefined) {
          this.runTotals.set(parsed.data.runId, parsed.data.costUsd);
        }
      }
    }
    return this.total();
  }

  total(): number {
    let sum = 0;
    for (const costUsd of this.runTotals.values()) sum += costUsd;
    return sum;
  }
}

/**
 * The reason the case must stop, or undefined while both budgets hold. The per-case cap applies to the case alone. The
 * run cap applies to what the earlier cases spent plus this case.
 */
export function budgetVerdict(caseUsd: number, limits: BudgetLimits): string | undefined {
  if (caseUsd > limits.caseUsd) {
    return `budget: the case spent $${caseUsd.toFixed(4)}, over the $${limits.caseUsd} per-case cap (--max-case-usd)`;
  }
  const runUsd = limits.spentBeforeUsd + caseUsd;
  if (runUsd > limits.totalUsd) {
    return `budget: the run spent $${runUsd.toFixed(4)} in total, over the $${limits.totalUsd} cap (--max-usd)`;
  }
  return undefined;
}

const ACTIVE_RUN: ReadonlySet<Run['status']> = new Set(['running', 'waiting_approval']);
const OPEN_TASK: ReadonlySet<Task['status']> = new Set(['open', 'in_progress']);

export interface StopTargets {
  threadIds: () => Promise<string[]>;
  /** Read on every pass, since a case creates its bots during setup. */
  botIds: () => string[];
}

/**
 * Cancels the case's runs that are still going and its open or in-progress tasks. A task cancel also stops the run that
 * does its work. Returns how many of each it cancelled.
 */
export async function cancelCaseWork(
  api: Pick<BrotApi, 'listRuns' | 'cancelRun' | 'listTasks' | 'patchTask'>,
  targets: StopTargets,
): Promise<{ runs: number; tasks: number }> {
  let runs = 0;
  let tasks = 0;
  for (const threadId of await targets.threadIds()) {
    for (const run of await api.listRuns(threadId)) {
      if (!ACTIVE_RUN.has(run.status)) continue;
      await api.cancelRun(run.id).catch(() => undefined);
      runs += 1;
    }
  }
  const seen = new Set<string>();
  const found: Task[] = [];
  for (const botId of targets.botIds()) {
    for (const task of await api.listTasks({ assigneeBotId: botId })) found.push(task);
  }
  for (const threadId of await targets.threadIds()) {
    for (const task of await api.listTasks({ threadId })) found.push(task);
  }
  for (const task of found) {
    if (seen.has(task.id) || !OPEN_TASK.has(task.status)) continue;
    seen.add(task.id);
    await api.patchTask(task.id, 'cancelled').catch(() => undefined);
    tasks += 1;
  }
  return { runs, tasks };
}

export interface BudgetGuardOptions {
  api: BudgetApi;
  limits: BudgetLimits;
  pollMs: number;
  targets: StopTargets;
  /** Called once, when the case crosses a budget. */
  onStop: (reason: string) => void;
  log: (line: string) => void;
}

export interface BudgetGuard {
  /** Cost of the case so far, as the last poll saw it. */
  costUsd(): number;
  /** Failed polls and cancels, kept for the report. */
  errors: string[];
  stop(): Promise<void>;
}

/**
 * Watches the case's cost while it runs. Once a budget is crossed it reports the reason, then keeps cancelling any work
 * that starts after that, until the case ends.
 */
export function startBudgetGuard(options: BudgetGuardOptions): BudgetGuard {
  const watch = new CostWatch(options.api);
  const errors: string[] = [];
  let current = 0;
  let tripped: string | undefined;
  const control = { stopping: false };

  const pass = async (): Promise<void> => {
    current = await watch.poll(await options.targets.threadIds());
    if (tripped === undefined) {
      const reason = budgetVerdict(current, options.limits);
      if (reason === undefined) return;
      tripped = reason;
      options.onStop(reason);
      options.log(reason);
    }
    await cancelCaseWork(options.api, options.targets);
  };

  const loop = (async () => {
    while (!control.stopping) {
      try {
        await pass();
      } catch (error) {
        errors.push(errorMessage(error));
      }
      await sleep(options.pollMs);
    }
  })();

  return {
    costUsd: () => current,
    errors,
    async stop() {
      control.stopping = true;
      await loop;
    },
  };
}
