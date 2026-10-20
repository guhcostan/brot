import type { Task } from '@brot/protocol';
import { chainBudgetSpent, errorMessage, inheritedAskHops, isTerminal, postBotMessage, type TeamDeps } from './context';
import type { BotRunOutcome, ChainRef, StartedRun } from './types';

/** What ending a task needs. Both `TeamDeps` and the task service have it. */
export type FinishDeps = Pick<TeamDeps, 'repos' | 'bus' | 'runner'>;

export type EndStatus = 'done' | 'failed' | 'cancelled';

export interface EndedTask {
  task: Task;
  /** The delegator's name, when it was told the task ended and started to continue from it. */
  notified?: string;
}

/** How a task ends when its work run does. A failed or cancelled run ends the task with the reason. */
export function endOf(outcome: BotRunOutcome): { status: EndStatus; result?: string } {
  if (outcome.status === 'completed') return { status: 'done', result: outcome.text || undefined };
  if (outcome.status === 'cancelled') return { status: 'cancelled', result: outcome.error ?? 'Run cancelled.' };
  return { status: 'failed', result: outcome.error ?? 'Run failed.' };
}

/**
 * Ends a task once. It gets the status and result, the result is posted in the thread the task was requested from, and
 * its delegator is told to continue. Returns undefined when the task had already ended, so the assignee's
 * `update_my_task` and the end of its work run cannot both end it. `runId` is the run that ends the task.
 */
export function endTask(
  deps: FinishDeps,
  taskId: string,
  end: { status: EndStatus; result?: string },
  runId: string,
): Promise<EndedTask | undefined> {
  return serialized(taskId, async () => {
    const current = await deps.repos.tasks.get(taskId);
    if (!current || isTerminal(current.status)) return undefined;
    const task = await deps.repos.tasks.update(taskId, {
      status: end.status,
      ...(end.result === undefined ? {} : { result: end.result }),
    });
    if (!task) return undefined;
    await deps.bus.publish({ type: 'task.updated', threadId: task.threadId, runId, task });
    await postBotMessage(deps, {
      threadId: task.threadId,
      runId,
      authorBotId: task.assigneeBotId,
      viaBotId: task.createdByBotId,
      content: resultMessage(task),
    });
    const notified = await notifyDelegator(deps, task, runId);
    return notified === undefined ? { task } : { task, notified };
  });
}

/** Ends a task when its work run settles. A task its assignee already ended is left as it is. */
export function watchWork(deps: FinishDeps, taskId: string, started: StartedRun): void {
  void started.settled
    .then((outcome) => endTask(deps, taskId, endOf(outcome), outcome.runId))
    .catch((error: unknown) => {
      console.error(`task ${taskId} could not be finished`, error);
    });
}

function resultMessage(task: Task): string {
  const heading = `**Task ${task.status}: ${task.title}**`;
  return task.result ? `${heading}\n\n${task.result}` : heading;
}

/**
 * Starts a short run for the bot that delegated an ended task, in the thread it delegated from. The run sits one level
 * above the task, so notices never nest deeper than the tasks they report on. Skipped when the delegator is gone or the
 * chain's budget is spent. Returns the delegator's name when it was told.
 */
async function notifyDelegator(deps: FinishDeps, task: Task, runId: string): Promise<string | undefined> {
  if (task.createdByBotId === undefined) return undefined;
  const delegator = await deps.repos.bots.get(task.createdByBotId);
  if (!delegator || delegator.archived) return undefined;
  if (await chainBudgetSpent(deps, task.chainId, [delegator.id, task.assigneeBotId])) return undefined;

  const assignee = (await deps.repos.bots.get(task.assigneeBotId))?.name ?? 'the assignee';
  const outcome = task.result ? `Result:\n${task.result}` : 'No result text was given.';
  const chain: ChainRef = {
    chainId: task.chainId,
    depth: task.depth - 1,
    askHops: inheritedAskHops(deps.runner, runId, task.chainId),
  };
  try {
    const started = await deps.runner.startBot({
      botId: delegator.id,
      threadId: task.threadId,
      input: `Task ${task.id} "${task.title}", which you delegated to ${assignee}, is ${task.status}.\n\n${outcome}\n\nContinue your work from this result.`,
      fromBotId: task.assigneeBotId,
      chain,
    });
    void started.settled
      .then((result) =>
        result.status === 'completed'
          ? undefined
          : reportUndelivered(deps, task, delegator.name, result.error ?? 'its run was cancelled'),
      )
      .catch((error: unknown) => console.error(`team: could not report on the notice for task ${task.id}`, error));
    return delegator.name;
  } catch (error) {
    await reportUndelivered(deps, task, delegator.name, errorMessage(error));
    return undefined;
  }
}

/**
 * Records in the task's thread that the delegator did not continue from an ended task, so the gap is visible where the
 * task was requested.
 */
async function reportUndelivered(deps: FinishDeps, task: Task, delegatorName: string, reason: string): Promise<void> {
  try {
    const message = await deps.repos.messages.create({
      threadId: task.threadId,
      role: 'system',
      content: `${delegatorName} could not continue from task "${task.title}" (${task.status}): ${reason}`,
    });
    await deps.bus.publish({ type: 'message.completed', threadId: task.threadId, message });
  } catch (error) {
    console.error(`team: could not record that ${delegatorName} was not notified about task ${task.id}`, error);
  }
}

/** Ending calls of one task run one after another, so the second sees the first's result. */
const ending = new Map<string, Promise<unknown>>();

function serialized<T>(taskId: string, work: () => Promise<T>): Promise<T> {
  const next = (ending.get(taskId) ?? Promise.resolve()).then(work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  ending.set(taskId, settled);
  void settled.then(() => {
    if (ending.get(taskId) === settled) ending.delete(taskId);
  });
  return next;
}
