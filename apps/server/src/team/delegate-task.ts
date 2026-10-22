import { DelegateTaskInput, TEAM_MAX_DEPTH, TEAM_MAX_TASKS_PER_CHAIN, type Bot, type Task } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall, ToolResult } from '../mcp/types';
import { chainBudgetSpent, errorMessage, isTerminal, resolveBot, type TeamDeps } from './context';
import { watchWork } from './finish';
import type { StartedRun } from './types';

interface DelegationPlan {
  parent?: Task;
  depth: number;
  askHops: number;
}

/** Hands a task to another bot. It starts in that bot's DM thread and runs without waiting. */
export function createDelegateTaskTool(deps: TeamDeps): BrotTool {
  return {
    spec: {
      name: 'delegate_task',
      description:
        'Hand a task with a clear deliverable to another bot, for work of more than one step. It works the task in the background and posts its result to this thread when it finishes. Returns the task id at once. Give exactly one of botId or botName.',
      inputSchema: inputSchemaOf(DelegateTaskInput),
      risk: 'write',
    },

    async prepare(scope, raw): Promise<PreparedCall | { error: string }> {
      const parsed = DelegateTaskInput.safeParse(raw);
      if (!parsed.success) return { error: invalidArguments(parsed.error) };
      const resolved = await resolveBot(deps.repos, parsed.data);
      if ('error' in resolved) return resolved;
      const target = resolved.bot;
      if (target.id === scope.botId) return { error: 'A bot cannot delegate a task to itself.' };

      const { title, description, parentTaskId } = parsed.data;
      const plan = await planDelegation(deps, scope, target, parentTaskId);
      if ('error' in plan) return plan;

      return {
        risk: 'write',
        kind: 'other',
        summary: `Delegate to ${target.name}: ${title}`.replace(/\s+/g, ' ').slice(0, 300),
        async run() {
          const current = await planDelegation(deps, scope, target, parentTaskId);
          if ('error' in current) return { ok: false, output: current.error };
          return delegate(deps, scope, target, { title, description }, current);
        },
      };
    },
  };
}

/**
 * Where a new delegation sits. Under a named parent it joins the parent's chain one level deeper. Without
 * one, a bot at the top of its chain gets a child in that chain, and a bot deeper than that must name
 * its parent, so a delegation can never reset the depth.
 */
async function planDelegation(
  deps: TeamDeps,
  scope: ApprovalScope,
  target: Bot,
  parentTaskId: string | undefined,
): Promise<DelegationPlan | { error: string }> {
  const { repos, runner } = deps;
  const callerChain = runner.chainOf(scope.runId);

  let parent: Task | undefined;
  if (parentTaskId !== undefined) {
    parent = await repos.tasks.get(parentTaskId);
    if (!parent) return { error: `No task has the id ${parentTaskId}.` };
    if (parent.chainId !== callerChain?.chainId) {
      return { error: `Task ${parentTaskId} is not in your chain. Name a task you were assigned.` };
    }
  } else if (callerChain) {
    const own = await repos.tasks.list({ chainId: callerChain.chainId, assigneeBotId: scope.botId });
    parent = own.filter((task) => task.depth === callerChain.depth && !isTerminal(task.status)).at(-1);
    if (!parent && callerChain.depth > 0) {
      return { error: 'Name parentTaskId: delegate under the task you are working on, so the new task stays in its chain.' };
    }
  }

  const depth = parent ? parent.depth + 1 : 1;
  if (depth > TEAM_MAX_DEPTH) {
    return {
      error: `A delegated task may be at most depth ${TEAM_MAX_DEPTH}; this one would be depth ${depth}. Do this part yourself.`,
    };
  }
  if (parent && (await repos.tasks.list({ chainId: parent.chainId })).length >= TEAM_MAX_TASKS_PER_CHAIN) {
    return { error: `This chain already holds ${TEAM_MAX_TASKS_PER_CHAIN} tasks.` };
  }
  const chainId = parent?.chainId ?? callerChain?.chainId;
  if (chainId !== undefined && (await chainBudgetSpent(deps, chainId, [scope.botId, target.id]))) {
    return { error: 'The team budget for this chain is spent, so no new work can start.' };
  }
  return { parent, depth, askHops: parent && callerChain ? callerChain.askHops : 0 };
}

async function delegate(
  deps: TeamDeps,
  scope: ApprovalScope,
  target: Bot,
  input: { title: string; description?: string },
  plan: DelegationPlan,
): Promise<ToolResult> {
  const { repos, bus, runner } = deps;

  let task: Task;
  try {
    task = await repos.tasks.create({
      title: input.title,
      description: input.description,
      assigneeBotId: target.id,
      threadId: scope.threadId,
      createdByBotId: scope.botId,
      parentTaskId: plan.parent?.id,
    });
  } catch (error) {
    return { ok: false, output: errorMessage(error) };
  }
  await bus.publish({ type: 'task.created', threadId: task.threadId, runId: scope.runId, task });

  const workThread =
    (await repos.threads.listByBot(target.id, { kind: 'dm' }))[0] ??
    (await repos.threads.create(target.id, { title: `Task: ${input.title}`.slice(0, 120) }));
  const working = await repos.tasks.update(task.id, { workThreadId: workThread.id, status: 'in_progress' });
  if (!working) return { ok: false, output: `Task ${task.id} disappeared before it could start.` };
  await bus.publish({ type: 'task.updated', threadId: working.threadId, runId: scope.runId, task: working });

  const callerName = (await repos.bots.get(scope.botId))?.name ?? 'another bot';
  const callerChain = runner.chainOf(scope.runId);
  if (callerChain !== undefined && callerChain.chainId !== working.chainId) {
    runner.linkBudget(working.chainId, callerChain.chainId);
  }
  let started: StartedRun;
  try {
    started = await runner.startBot({
      botId: target.id,
      threadId: workThread.id,
      input: assignment(callerName, working),
      fromBotId: scope.botId,
      chain: { chainId: working.chainId, depth: working.depth, askHops: plan.askHops },
    });
  } catch (error) {
    const reason = `Could not start ${target.name}: ${errorMessage(error)}`;
    const failed = await repos.tasks.update(task.id, { status: 'failed', result: reason });
    if (failed) await bus.publish({ type: 'task.updated', threadId: failed.threadId, runId: scope.runId, task: failed });
    return { ok: false, output: reason };
  }
  await repos.tasks.update(task.id, { workRunId: started.runId });
  watchWork(deps, task.id, started);

  return {
    ok: true,
    output: `Delegated task ${task.id} to ${target.name}. It runs in the background; its result is posted to this thread when it finishes.`,
  };
}

function assignment(callerName: string, task: Task): string {
  const details = task.description ? `\n\n${task.description}` : '';
  return [
    `${callerName} assigned you a task.`,
    `Task ${task.id}: ${task.title}${details}`,
    `Work on it in this thread. When you are finished, call update_my_task once with taskId "${task.id}", status "done", and the deliverable in result. If you cannot finish, call it once with status "failed" and the reason in result.`,
  ].join('\n\n');
}
