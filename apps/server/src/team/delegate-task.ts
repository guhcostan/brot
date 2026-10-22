import { DelegateTaskInput, TEAM_MAX_DEPTH, TEAM_MAX_TASKS_PER_CHAIN, type Bot, type Task } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { inputSchemaOf, invalidArguments } from '../mcp/helpers';
import type { BrotTool, PreparedCall, ToolResult } from '../mcp/types';
import { chainBudgetSpent, errorMessage, isTerminal, resolveBot, type TeamDeps } from './context';
import { finishTask } from './update-my-task';
import type { BotRunOutcome } from './types';

interface DelegationPlan {
  parent?: Task;
  depth: number;
  askHops: number;
  /** True when the caller is a top-level run (not a work run), so its delegations share one chain. */
  topLevel: boolean;
  /** The chain a top-level run's earlier delegation started. Undefined until the run's first delegation. */
  rootChainId?: string;
}

/**
 * The chain each top-level run's delegations share. The run's first delegation starts the chain with its own
 * id and records it here; later delegations from the same run join it. Keyed by run, so two runs never share.
 */
interface RootChains {
  get(runId: string): string | undefined;
  set(runId: string, chainId: string): void;
  /** Runs `work` after earlier work for the same run, so parallel delegations from one run settle one chain. */
  exclusive<T>(runId: string, work: () => Promise<T>): Promise<T>;
}

const MAX_TRACKED_RUNS = 1024;

function createRootChains(): RootChains {
  const chains = new Map<string, string>();
  const queues = new Map<string, Promise<unknown>>();
  return {
    get: (runId) => chains.get(runId),
    set(runId, chainId) {
      if (!chains.has(runId) && chains.size >= MAX_TRACKED_RUNS) {
        const oldest = chains.keys().next();
        if (!oldest.done) chains.delete(oldest.value);
      }
      chains.set(runId, chainId);
    },
    exclusive<T>(runId: string, work: () => Promise<T>): Promise<T> {
      const next = (queues.get(runId) ?? Promise.resolve()).then(work, work);
      const tail = next.then(
        () => undefined,
        () => undefined,
      );
      queues.set(runId, tail);
      void tail.then(() => {
        if (queues.get(runId) === tail) queues.delete(runId);
      });
      return next;
    },
  };
}

/** Hands a task to another bot. It starts in that bot's DM thread and runs without waiting. */
export function createDelegateTaskTool(deps: TeamDeps): BrotTool {
  const roots = createRootChains();
  return {
    spec: {
      name: 'delegate_task',
      description:
        'Hand a task to another bot. It works the task in the background, in its own thread, and posts the result to this thread when it is done. Returns the task id at once. Give exactly one of botId or botName.',
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
      const plan = await planDelegation(deps, scope, target, parentTaskId, roots);
      if ('error' in plan) return plan;

      return {
        risk: 'write',
        kind: 'other',
        summary: `Delegate to ${target.name}: ${title}`.replace(/\s+/g, ' ').slice(0, 300),
        run() {
          return roots.exclusive(scope.runId, async () => {
            const current = await planDelegation(deps, scope, target, parentTaskId, roots);
            if ('error' in current) return { ok: false, output: current.error };
            return delegate(deps, scope, target, { title, description }, current, roots);
          });
        },
      };
    },
  };
}

/**
 * Where a new delegation sits. Under a named parent it joins the parent's chain one level deeper. Without
 * one, a work run's delegation is a child in its own chain, and a top-level run's delegations all share the
 * chain its first delegation started. A work run deeper than the top must name its parent, so a delegation
 * can never reset the depth.
 */
async function planDelegation(
  deps: TeamDeps,
  scope: ApprovalScope,
  target: Bot,
  parentTaskId: string | undefined,
  roots: RootChains,
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

  const topLevel = callerChain === undefined;
  const rootChainId = parent === undefined && topLevel ? roots.get(scope.runId) : undefined;
  const depth = parent ? parent.depth + 1 : 1;
  if (depth > TEAM_MAX_DEPTH) {
    return {
      error: `A delegated task may be at most depth ${TEAM_MAX_DEPTH}; this one would be depth ${depth}. Do this part yourself.`,
    };
  }
  const chainId = parent?.chainId ?? callerChain?.chainId ?? rootChainId;
  if (chainId !== undefined && (await repos.tasks.list({ chainId })).length >= TEAM_MAX_TASKS_PER_CHAIN) {
    return { error: `This chain already holds ${TEAM_MAX_TASKS_PER_CHAIN} tasks.` };
  }
  if (chainId !== undefined && (await chainBudgetSpent(deps, chainId, [scope.botId, target.id]))) {
    return { error: 'The team budget for this chain is spent, so no new work can start.' };
  }
  return { parent, depth, askHops: parent && callerChain ? callerChain.askHops : 0, topLevel, rootChainId };
}

async function delegate(
  deps: TeamDeps,
  scope: ApprovalScope,
  target: Bot,
  input: { title: string; description?: string },
  plan: DelegationPlan,
  roots: RootChains,
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
      chainId: plan.parent === undefined ? plan.rootChainId : undefined,
    });
  } catch (error) {
    return { ok: false, output: errorMessage(error) };
  }
  if (plan.topLevel && plan.rootChainId === undefined) {
    roots.set(scope.runId, task.chainId);
    // The caller run's spend now counts toward this chain, once, whatever number of delegations it makes.
    runner.attachSpend?.(scope.runId, task.chainId);
  }
  await bus.publish({ type: 'task.created', threadId: task.threadId, runId: scope.runId, task });

  const workThread =
    (await repos.threads.listByBot(target.id, { kind: 'dm' }))[0] ??
    (await repos.threads.create(target.id, { title: `Task: ${input.title}`.slice(0, 120) }));
  const working = await repos.tasks.update(task.id, { workThreadId: workThread.id, status: 'in_progress' });
  if (!working) return { ok: false, output: `Task ${task.id} disappeared before it could start.` };
  await bus.publish({ type: 'task.updated', threadId: working.threadId, runId: scope.runId, task: working });

  const callerName = (await repos.bots.get(scope.botId))?.name ?? 'another bot';
  try {
    const started = await runner.startBot({
      botId: target.id,
      threadId: workThread.id,
      input: assignment(callerName, working),
      fromBotId: scope.botId,
      chain: { chainId: working.chainId, depth: working.depth, askHops: plan.askHops },
    });
    const workScope: ApprovalScope = { botId: target.id, threadId: workThread.id, runId: started.runId };
    void started.settled
      .then((outcome) => closeAbandonedTask(deps, task.id, workScope, outcome))
      .catch((error: unknown) => console.error(`team: task ${task.id} could not be closed after its run ended`, error));
  } catch (error) {
    const reason = `Could not start ${target.name}: ${errorMessage(error)}`;
    const failed = await repos.tasks.update(task.id, { status: 'failed', result: reason });
    if (failed) await bus.publish({ type: 'task.updated', threadId: failed.threadId, runId: scope.runId, task: failed });
    return { ok: false, output: reason };
  }

  return {
    ok: true,
    output: `Delegated task ${task.id} to ${target.name}. It runs in the background; its result is posted to this thread when it finishes.`,
  };
}

/**
 * A work run that ends while its task is still open closes the task with the run's outcome. A completed run
 * finishes the task with its final text; a failed or cancelled run fails it with the reason. This is the same
 * rule the rooms task board applies to tasks it starts, so a task never waits on a run that is gone.
 */
async function closeAbandonedTask(deps: TeamDeps, taskId: string, scope: ApprovalScope, outcome: BotRunOutcome): Promise<void> {
  const current = await deps.repos.tasks.get(taskId);
  if (!current || isTerminal(current.status)) return;
  if (outcome.status === 'completed') {
    await finishTask(deps, scope, taskId, 'done', outcome.text || undefined);
    return;
  }
  const reason = outcome.error ?? (outcome.status === 'cancelled' ? 'Run cancelled.' : 'Run failed.');
  await finishTask(deps, scope, taskId, 'failed', reason);
}

function assignment(callerName: string, task: Task): string {
  const details = task.description ? `\n\n${task.description}` : '';
  return [
    `${callerName} assigned you a task.`,
    `Task ${task.id}: ${task.title}${details}`,
    `Work on it in this thread. Report progress by calling update_my_task with taskId "${task.id}" and status "in_progress". When you are finished, call update_my_task with taskId "${task.id}", status "done", and the result in result. If you cannot finish, call it with status "failed" and the reason in result.`,
  ].join('\n\n');
}
