import type { Repos } from '@brot/db';
import type {
  CanonicalEvent,
  IsoDateTime,
  Routine,
  RoutineRun,
  RoutineRunTrigger,
  RoutineTrigger,
} from '@brot/protocol';
import { Cron } from 'croner';
import type { EventBus } from './bus';
import type { Harness } from './harness';

/** How long after a missed occurrence catch-up still fires it. */
export const CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000;

/** A completed run keeps at most this much of the assistant's final message. */
const RESULT_MAX_LENGTH = 4000;

/** A remembered result is cut to this much before it is prepended to the instruction. */
const REMEMBERED_RESULT_MAX_LENGTH = 2000;

/** What a routine run attempt did: started an engine run, or found the routine already running. */
export type RoutineRunStart =
  | { status: 'running'; routineRunId: string; runId: string }
  | { status: 'skipped'; routineRunId: string };

export interface RunRoutineNowOptions {
  payload?: unknown;
  /** Default `manual`. The webhook receiver passes `webhook`. */
  trigger?: RoutineRunTrigger;
}

export interface Scheduler {
  /** Re-reads enabled cron routines from the database, reschedules them, and catches up missed runs. */
  sync(): Promise<void>;
  /** Starts a run now and records it. `undefined` when the routine does not exist. */
  runRoutineNow(routineId: string, options?: RunRoutineNowOptions): Promise<RoutineRunStart | undefined>;
  stop(): void;
}

/** Returns why a cron pattern is invalid, or undefined when it parses. Forces the timezone check a paused job defers. */
export function cronError(pattern: string, timezone?: string): string | undefined {
  try {
    const job = new Cron(pattern, { paused: true, ...(timezone === undefined ? {} : { timezone }) });
    job.nextRun();
    job.stop();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Returns why a timezone name is invalid, or undefined when croner accepts it. */
export function timezoneError(timezone: string): string | undefined {
  try {
    const job = new Cron('0 0 * * *', { paused: true, timezone });
    job.nextRun();
    job.stop();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The most recent occurrence missed since `lastRunAt` (or the routine's creation, for one that never ran),
 * when that occurrence falls inside the catch-up window.
 */
export function missedOccurrence(job: Cron, lastRunAt: IsoDateTime, now: Date): Date | undefined {
  const [previous] = job.previousRuns(1, now);
  if (previous === undefined) return undefined;
  const last = Date.parse(lastRunAt);
  if (Number.isNaN(last) || last >= previous.getTime()) return undefined;
  const age = now.getTime() - previous.getTime();
  if (age < 0 || age > CATCH_UP_WINDOW_MS) return undefined;
  return previous;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SchedulerDeps {
  repos: Repos;
  harness: Harness;
  bus: EventBus;
  /** The clock catch-up decisions read. Tests inject a fixed time. */
  now?: () => Date;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { repos, harness, bus } = deps;
  const clock = deps.now ?? (() => new Date());
  const jobs = new Map<string, Cron>();
  /** Live records by routine run id, by the routine they belong to. */
  const activeRecords = new Map<string, string>();
  /** The run holding each routine's overlap guard, by routine id. */
  const activeRoutine = new Map<string, string>();
  /** The routine run started by each engine run. */
  const recordByRunId = new Map<string, string>();
  /** Routines a catch-up started this boot, so a resync never catches the same routine up twice. */
  const caughtUp = new Set<string>();
  /** One fire at a time per routine, so two triggers cannot both pass the overlap guard. */
  const locks = new Map<string, Promise<void>>();
  let reconciled = false;

  async function withLock<T>(routineId: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(routineId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    locks.set(routineId, tail);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (locks.get(routineId) === tail) locks.delete(routineId);
    }
  }

  async function threadFor(routine: Routine) {
    const existing = (await repos.threads
      .listByBot(routine.botId, { kind: 'dm' }))
      .find((thread) => thread.title === routine.name);
    return existing ?? repos.threads.create(routine.botId, { title: routine.name });
  }

  async function instructionFor(routine: Routine): Promise<string> {
    if (routine.rememberLastRun !== true) return routine.instruction;
    const last = await repos.routineRuns.latestCompleted(routine.id);
    if (last?.result === undefined || last.result === '') return routine.instruction;
    return `Previous run result:\n${last.result.slice(0, REMEMBERED_RESULT_MAX_LENGTH)}\n\n${routine.instruction}`;
  }

  async function lastAssistantMessage(threadId: string): Promise<string | undefined> {
    const messages = await repos.messages.listByThread(threadId);
    const last = messages.findLast((message) => message.role === 'assistant');
    return last?.content.slice(0, RESULT_MAX_LENGTH);
  }

  /** The routine run holding the routine's guard, from this process's records or from the database. */
  async function activeRunOf(routineId: string): Promise<RoutineRun | undefined> {
    const known = activeRoutine.get(routineId);
    if (known !== undefined) {
      const record = await repos.routineRuns.get(known);
      if (record) return record;
      activeRoutine.delete(routineId);
    }
    const [active] = await repos.routineRuns.activeByRoutine(routineId);
    return active;
  }

  async function writeNextRunAt(routine: Routine, lastRunAt?: IsoDateTime): Promise<void> {
    await repos.routines.update(routine.id, {
      ...(lastRunAt === undefined ? {} : { lastRunAt }),
      nextRunAt: jobs.get(routine.id)?.nextRun()?.toISOString() ?? null,
    });
  }

  async function startRoutineRun(
    routine: Routine,
    options: { trigger: RoutineRunTrigger; payload?: unknown },
  ): Promise<RoutineRunStart> {
    const active = await activeRunOf(routine.id);
    if (active !== undefined) {
      const skipped = await repos.routineRuns.create({
        routineId: routine.id,
        botId: routine.botId,
        threadId: active.threadId,
        trigger: options.trigger,
        status: 'skipped',
        error: 'already running',
        endedAt: new Date().toISOString(),
      });
      return { status: 'skipped', routineRunId: skipped.id };
    }

    const thread = await threadFor(routine);
    const record = await repos.routineRuns.create({
      routineId: routine.id,
      botId: routine.botId,
      threadId: thread.id,
      trigger: options.trigger,
      status: 'running',
    });
    activeRecords.set(record.id, routine.id);
    activeRoutine.set(routine.id, record.id);
    try {
      const instruction = await instructionFor(routine);
      const input =
        options.payload === undefined
          ? instruction
          : `${instruction}\n\nWebhook payload:\n${JSON.stringify(options.payload)}`;
      const { runId } = await harness.startRun(thread.id, input);
      recordByRunId.set(runId, record.id);
      await repos.routineRuns.update(record.id, { runId });
      await writeNextRunAt(routine, new Date().toISOString());
      return { status: 'running', routineRunId: record.id, runId };
    } catch (error) {
      activeRecords.delete(record.id);
      activeRoutine.delete(routine.id);
      const message = errorMessage(error);
      await repos.routineRuns.update(record.id, {
        status: 'failed',
        error: message,
        endedAt: new Date().toISOString(),
      });
      await writeNextRunAt(routine);
      throw error;
    }
  }

  async function fire(routine: Routine, options: { trigger: RoutineRunTrigger; payload?: unknown }): Promise<RoutineRunStart> {
    return withLock(routine.id, () => startRoutineRun(routine, options));
  }

  /** Marks the run record terminal once the harness reports how the engine run ended, and captures its result. */
  async function settleRun(
    recordId: string,
    type: 'run.completed' | 'run.failed',
    threadId: string,
    error?: string,
  ): Promise<void> {
    activeRecords.delete(recordId);
    for (const [routineId, holding] of activeRoutine) {
      if (holding === recordId) activeRoutine.delete(routineId);
    }

    const record = await repos.routineRuns.get(recordId);
    if (record?.status !== 'running' && record?.status !== 'queued') return;
    const endedAt = new Date().toISOString();
    if (type === 'run.completed') {
      const result = await lastAssistantMessage(threadId);
      await repos.routineRuns.update(recordId, {
        status: 'completed',
        endedAt,
        ...(result === undefined ? {} : { result }),
      });
      return;
    }
    await repos.routineRuns.update(recordId, { status: 'failed', endedAt, error: error ?? 'Run failed.' });
  }

  function handleRunEvent(event: CanonicalEvent): void {
    if (event.type !== 'run.completed' && event.type !== 'run.failed') return;
    const runId = event.runId;
    if (runId === undefined) return;
    const recordId = recordByRunId.get(runId);
    if (recordId === undefined) return;
    recordByRunId.delete(runId);
    const error = event.type === 'run.failed' ? event.error : undefined;
    void settleRun(recordId, event.type, event.threadId, error).catch((reason: unknown) =>
      console.error(`routine run ${recordId} could not be settled`, reason),
    );
  }

  const unsubscribe = bus.subscribe(handleRunEvent);

  /** Records left active by a previous process can never finish: fail them so their routine is not blocked forever. */
  async function reconcileInterrupted(): Promise<void> {
    if (reconciled) return;
    reconciled = true;
    for (const status of ['queued', 'running'] as const) {
      for (const record of await repos.routineRuns.list({ status })) {
        if (activeRecords.has(record.id)) continue;
        await repos.routineRuns.update(record.id, {
          status: 'failed',
          error: 'server restarted',
          endedAt: new Date().toISOString(),
        });
      }
    }
  }

  /** Fires one missed occurrence per routine, once per boot, when it is inside the catch-up window. */
  async function catchUpMissed(routines: readonly Routine[]): Promise<void> {
    const now = clock();
    for (const routine of routines) {
      if (!routine.enabled || routine.trigger.type !== 'cron' || routine.catchUp === false) continue;
      if (caughtUp.has(routine.id)) continue;
      const job = jobs.get(routine.id);
      const since = routine.lastRunAt ?? routine.createdAt;
      if (job === undefined || missedOccurrence(job, since, now) === undefined) continue;
      if ((await activeRunOf(routine.id)) !== undefined) continue;
      try {
        const result = await fire(routine, { trigger: 'schedule' });
        if (result.status === 'running') caughtUp.add(routine.id);
      } catch (error) {
        console.error(`routine ${routine.id} catch-up failed`, error);
      }
    }
  }

  function stopAll(): void {
    for (const job of jobs.values()) job.stop();
    jobs.clear();
  }

  async function rebuild(): Promise<void> {
    stopAll();
    await reconcileInterrupted();
    const routines = await repos.routines.list();
    for (const routine of routines) {
      if (!routine.enabled || routine.trigger.type !== 'cron') {
        // A routine with no job has no next run; clear a timestamp left by a previous schedule or trigger.
        if (routine.nextRunAt !== undefined) await repos.routines.update(routine.id, { nextRunAt: null });
        continue;
      }
      const routineId = routine.id;
      const timezone = routine.trigger.timezone;
      const job = new Cron(
        routine.trigger.cron,
        timezone === undefined ? {} : { timezone },
        () => {
          void repos.routines
            .get(routineId)
            .then((current) => (current?.enabled ? fire(current, { trigger: 'schedule' }) : undefined))
            .catch((error: unknown) => console.error(`routine ${routineId} failed`, error));
        },
      );
      jobs.set(routine.id, job);
      await repos.routines.update(routine.id, { nextRunAt: job.nextRun()?.toISOString() });
    }
    await catchUpMissed(routines);
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
      return fire(routine, {
        trigger: options.trigger ?? 'manual',
        ...(options.payload === undefined ? {} : { payload: options.payload }),
      });
    },

    stop() {
      unsubscribe();
      stopAll();
      activeRecords.clear();
      activeRoutine.clear();
      recordByRunId.clear();
    },
  };
}

/** The trigger issues a routine request has: an invalid cron pattern or timezone. */
export function triggerIssues(trigger: RoutineTrigger): { path: string[]; message: string }[] {
  if (trigger.type !== 'cron') return [];
  if (trigger.timezone !== undefined) {
    const message = timezoneError(trigger.timezone);
    if (message !== undefined) {
      return [{ path: ['trigger', 'timezone'], message: `Invalid timezone: ${message}` }];
    }
  }
  const message = cronError(trigger.cron, trigger.timezone);
  return message === undefined ? [] : [{ path: ['trigger', 'cron'], message: `Invalid cron pattern: ${message}` }];
}
