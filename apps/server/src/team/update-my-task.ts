import { UpdateMyTaskInput, type Task } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall, ToolResult } from '../mcp/types';
import { chainBudgetSpent, errorMessage, inheritedAskHops, isTerminal, postBotMessage, type TeamDeps } from './context';
import type { ChainRef } from './types';

/** The assignee reports on its own task. Finishing it posts the result back and tells the delegator. */
export function createUpdateMyTaskTool(deps: TeamDeps): BrotTool {
  return {
    spec: {
      name: 'update_my_task',
      description:
        'Report progress on a task assigned to you. Finish it with status done or failed and a result. The result is posted to the thread where the task was requested, and the bot that delegated it is told to continue.',
      inputSchema: inputSchemaOf(UpdateMyTaskInput),
      risk: 'write',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = UpdateMyTaskInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const { taskId, status, result } = parsed.data;
      const loaded = await loadAssigned(deps, scope.botId, taskId);
      if (typeof loaded === 'string') return { error: loaded };
      return {
        risk: 'write',
        kind: 'other',
        summary: `Task "${loaded.title}" is now ${status}`.slice(0, 300),
        async run() {
          return finishTask(deps, scope, taskId, status, result);
        },
      };
    },
  };
}

/** The task when the bot may still update it, or the reason it may not. */
async function loadAssigned(deps: TeamDeps, botId: string, taskId: string): Promise<Task | string> {
  const task = await deps.repos.tasks.get(taskId);
  if (!task) return `No task has the id ${taskId}.`;
  if (task.assigneeBotId !== botId) return `Task ${taskId} is assigned to another bot. Only its assignee can update it.`;
  if (isTerminal(task.status)) return `Task ${taskId} is already ${task.status}.`;
  return task;
}

/**
 * Records the assignee's status on its task, posts a finished result back to the requesting thread, and tells the
 * delegator. The harness also calls it when a work run ends without the assignee closing the task, so no task stays
 * open once nothing works on it.
 */
export async function finishTask(
  deps: TeamDeps,
  scope: ApprovalScope,
  taskId: string,
  status: 'in_progress' | 'blocked' | 'done' | 'failed',
  result: string | undefined,
): Promise<ToolResult> {
  const loaded = await loadAssigned(deps, scope.botId, taskId);
  if (typeof loaded === 'string') return { ok: false, output: loaded };

  const updated = await deps.repos.tasks.update(taskId, { status, ...(result !== undefined ? { result } : {}) });
  if (!updated) return { ok: false, output: `No task has the id ${taskId}.` };
  await deps.bus.publish({ type: 'task.updated', threadId: updated.threadId, runId: scope.runId, task: updated });

  if (status !== 'done' && status !== 'failed') return { ok: true, output: `Task ${taskId} is ${status}.` };

  await postBotMessage(deps, {
    threadId: updated.threadId,
    runId: scope.runId,
    authorBotId: scope.botId,
    viaBotId: updated.createdByBotId,
    content: resultMessage(updated),
  });
  const delegator = await notifyDelegator(deps, scope, updated);
  const followUp = delegator ? ` ${delegator} was notified and will continue from the result.` : '';
  return { ok: true, output: `Task ${taskId} is ${status}.${followUp}` };
}

function resultMessage(task: Task): string {
  const heading = `**Task ${task.status}: ${task.title}**`;
  return task.result ? `${heading}\n\n${task.result}` : heading;
}

/**
 * Starts a short run for the bot that delegated a finished task, in the thread it delegated from. A task
 * ends once, so it notifies once. The run sits one level above the task, so notifications never nest
 * deeper than the tasks they report on. Returns the delegator's name when it was notified.
 */
async function notifyDelegator(deps: TeamDeps, scope: ApprovalScope, task: Task): Promise<string | undefined> {
  if (task.createdByBotId === undefined) return undefined;
  const delegator = await deps.repos.bots.get(task.createdByBotId);
  if (!delegator || delegator.archived) return undefined;
  if (await chainBudgetSpent(deps, task.chainId, [delegator.id, scope.botId])) return undefined;

  const assignee = (await deps.repos.bots.get(scope.botId))?.name ?? 'the assignee';
  const outcome = task.result ? `Result:\n${task.result}` : 'No result text was given.';
  const chain: ChainRef = {
    chainId: task.chainId,
    depth: task.depth - 1,
    askHops: inheritedAskHops(deps.runner, scope.runId, task.chainId),
  };
  try {
    const started = await deps.runner.startBot({
      botId: delegator.id,
      threadId: task.threadId,
      input: `Task ${task.id} "${task.title}", which you delegated to ${assignee}, is ${task.status}.\n\n${outcome}\n\nContinue your work from this result.`,
      fromBotId: scope.botId,
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
 * Records in the task's thread that the delegator did not continue from a finished task, so the gap is visible
 * where the task was requested.
 */
async function reportUndelivered(deps: TeamDeps, task: Task, delegatorName: string, reason: string): Promise<void> {
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
