import type { Repos } from '@brot/db';
import type { Routine } from '@brot/protocol';
import { Cron } from 'croner';
import type { Harness } from './harness';

export interface Scheduler {
  /** Re-reads enabled cron routines from the database and reschedules them. Call after any routine change. */
  sync(): Promise<void>;
  runRoutineNow(routineId: string, options?: { payload?: unknown }): Promise<{ runId: string } | undefined>;
  stop(): void;
}

/** Returns why a cron pattern is invalid, or undefined when it parses. */
export function cronError(pattern: string): string | undefined {
  try {
    new Cron(pattern, { paused: true }).stop();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function createScheduler(deps: { repos: Repos; harness: Harness }): Scheduler {
  const { repos, harness } = deps;
  const jobs = new Map<string, Cron>();

  async function threadFor(routine: Routine) {
    const existing = (await repos.threads.listByBot(routine.botId)).find((thread) => thread.title === routine.name);
    return existing ?? repos.threads.create(routine.botId, { title: routine.name });
  }

  async function fire(routine: Routine, payload?: unknown): Promise<{ runId: string }> {
    const thread = await threadFor(routine);
    const input =
      payload === undefined
        ? routine.instruction
        : `${routine.instruction}\n\nWebhook payload:\n${JSON.stringify(payload)}`;
    const result = await harness.startRun(thread.id, input);
    await repos.routines.update(routine.id, {
      lastRunAt: new Date().toISOString(),
      nextRunAt: jobs.get(routine.id)?.nextRun()?.toISOString(),
    });
    return result;
  }

  function stopAll(): void {
    for (const job of jobs.values()) job.stop();
    jobs.clear();
  }

  async function rebuild(): Promise<void> {
    stopAll();
    for (const routine of await repos.routines.list()) {
      if (!routine.enabled || routine.trigger.type !== 'cron') continue;
      const routineId = routine.id;
      const job = new Cron(routine.trigger.cron, () => {
        void repos.routines
          .get(routineId)
          .then((current) => (current?.enabled ? fire(current) : undefined))
          .catch((error: unknown) => console.error(`routine ${routineId} failed`, error));
      });
      jobs.set(routine.id, job);
      await repos.routines.update(routine.id, { nextRunAt: job.nextRun()?.toISOString() });
    }
  }

  // Rebuilds never overlap: two interleaved rebuilds could each create jobs and orphan the other's.
  let rebuilding: Promise<void> = Promise.resolve();

  return {
    sync() {
      rebuilding = rebuilding.then(rebuild, rebuild);
      return rebuilding;
    },

    async runRoutineNow(routineId, options = {}) {
      const routine = await repos.routines.get(routineId);
      if (!routine) return undefined;
      return fire(routine, options.payload);
    },

    stop: stopAll,
  };
}
