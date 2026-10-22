import { UpdateMyTaskInput, type Task } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall, ToolResult } from '../mcp/types';
import { isTerminal, type TeamDeps } from './context';
import { endTask } from './finish';

/** The assignee reports on its own task. Finishing it posts the result back and tells the delegator. */
export function createUpdateMyTaskTool(deps: TeamDeps): BrotTool {
  return {
    spec: {
      name: 'update_my_task',
      description:
        'Report on a task assigned to you. Call it once when the task is finished: status done with the deliverable in result, or failed with the reason. Use in_progress or blocked only when you cannot continue.',
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
          return finish(deps, scope, taskId, status, result);
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

async function finish(
  deps: TeamDeps,
  scope: ApprovalScope,
  taskId: string,
  status: 'in_progress' | 'blocked' | 'done' | 'failed',
  result: string | undefined,
): Promise<ToolResult> {
  const loaded = await loadAssigned(deps, scope.botId, taskId);
  if (typeof loaded === 'string') return { ok: false, output: loaded };

  if (status === 'in_progress' || status === 'blocked') {
    const updated = await deps.repos.tasks.update(taskId, { status, ...(result !== undefined ? { result } : {}) });
    if (!updated) return { ok: false, output: `No task has the id ${taskId}.` };
    await deps.bus.publish({ type: 'task.updated', threadId: updated.threadId, runId: scope.runId, task: updated });
    return { ok: true, output: `Task ${taskId} is ${status}.` };
  }

  const ended = await endTask(deps, taskId, { status, ...(result !== undefined ? { result } : {}) }, scope.runId);
  if (!ended) {
    const current = await deps.repos.tasks.get(taskId);
    return { ok: false, output: `Task ${taskId} is already ${current?.status ?? 'closed'}.` };
  }
  const followUp = ended.notified ? ` ${ended.notified} was notified and will continue from the result.` : '';
  return { ok: true, output: `Task ${taskId} is ${ended.task.status}.${followUp}` };
}
