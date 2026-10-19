import type { Repos, TaskFilter } from '@brot/db';
import {
  CreateTask,
  TEAM_MAX_DEPTH,
  TEAM_MAX_TASKS_PER_CHAIN,
  type CreateTaskInput,
  type Task,
  type UpdateTask,
} from '@brot/protocol';
import type { EventBus } from '../bus';
import type { Harness } from '../harness';
import type { BotRunOutcome } from '../team/types';
import { RuleViolation } from './errors';

export interface TaskDetail extends Task {
  children: Task[];
}

export interface TaskService {
  list(filter: TaskFilter): Promise<Task[]>;
  get(id: string): Promise<TaskDetail | undefined>;
  /**
   * Creates a task and starts its assignee on it. A task with no creator is the user's (depth 0). Throws
   * `RuleViolation` when the repository refuses it (depth, chain size).
   */
  create(input: CreateTaskInput): Promise<Task>;
  /** Patches a task. Throws `RuleViolation` when the task already ended. */
  update(id: string, patch: UpdateTask): Promise<Task | undefined>;
}

const ENDED: ReadonlyArray<Task['status']> = ['done', 'failed', 'cancelled'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How a task ends when its work run does. A failed or cancelled run ends the task with the reason. */
function endOf(outcome: BotRunOutcome): UpdateTask {
  if (outcome.status === 'completed') return { status: 'done', result: outcome.text || undefined };
  if (outcome.status === 'cancelled') return { status: 'cancelled', result: outcome.error ?? 'Run cancelled.' };
  return { status: 'failed', result: outcome.error ?? 'Run failed.' };
}

/** The task board. Starting a task runs its assignee in that bot's most recent DM, or in a new one. */
export function createTaskService(deps: { repos: Repos; bus: EventBus; harness: () => Harness }): TaskService {
  const { repos, bus } = deps;

  async function emitUpdated(task: Task): Promise<void> {
    await bus.publish({ type: 'task.updated', threadId: task.threadId, task });
  }

  /**
   * Patches a task. A cancel also stops the run doing the work. The run id is read from the row this write
   * returns, so a run linked by a concurrent `startWork` is not missed.
   */
  async function patch(id: string, input: UpdateTask): Promise<Task | undefined> {
    const current = await repos.tasks.get(id);
    if (!current) return undefined;
    if (ENDED.includes(current.status)) throw new RuleViolation(`task is already ${current.status}`);
    const task = await repos.tasks.update(id, input);
    if (!task) return undefined;
    await emitUpdated(task);
    if (task.status === 'cancelled' && task.workRunId !== undefined) {
      await deps.harness().cancelRun(task.workRunId);
    }
    return task;
  }

  /** A delegation must stay within the depth limit and leave room in its chain. */
  async function admit(parentTaskId: string | undefined): Promise<void> {
    if (parentTaskId === undefined) return;
    const parent = await repos.tasks.get(parentTaskId);
    if (!parent) throw new RuleViolation(`parent task ${parentTaskId} does not exist`);
    if (parent.depth + 1 > TEAM_MAX_DEPTH) {
      throw new RuleViolation(`a task may be at most depth ${TEAM_MAX_DEPTH}, not ${parent.depth + 1}`);
    }
    const held = await repos.tasks.list({ chainId: parent.chainId });
    if (held.length >= TEAM_MAX_TASKS_PER_CHAIN) {
      throw new RuleViolation(`chain ${parent.chainId} already holds ${TEAM_MAX_TASKS_PER_CHAIN} tasks`);
    }
  }

  async function workThreadFor(botId: string, title: string): Promise<string> {
    const [existing] = await repos.threads.listByBot(botId, { kind: 'dm' });
    if (existing) return existing.id;
    return (await repos.threads.create(botId, { title })).id;
  }

  function workInput(task: Task): string {
    const lines = [task.title];
    if (task.description) lines.push('', task.description);
    lines.push('', `Task id: ${task.id}`);
    return lines.join('\n');
  }

  /**
   * Starts the assignee on a task. A run that cannot start fails the task with the reason, so the board
   * never keeps an open task that nothing works on. When the work run ends, the task ends with it unless
   * the assignee already closed it.
   */
  async function startWork(task: Task): Promise<Task> {
    try {
      const threadId = await workThreadFor(task.assigneeBotId, task.title);
      // Marked before the run starts: a run that finishes first would otherwise end the task before this.
      const working = await patch(task.id, { status: 'in_progress', workThreadId: threadId });
      const started = await deps.harness().startBotRun({
        botId: task.assigneeBotId,
        threadId,
        input: workInput(task),
        ...(task.createdByBotId === undefined ? {} : { fromBotId: task.createdByBotId }),
        chain: { chainId: task.chainId, depth: task.depth, askHops: 0 },
      });
      const linked = await repos.tasks.update(task.id, { workRunId: started.runId });
      // A cancel that landed before the run was linked could not see the run, so this run is stopped here.
      if (linked?.status === 'cancelled') await deps.harness().cancelRun(started.runId);
      void started.settled.then(async (outcome) => {
        const current = await repos.tasks.get(task.id);
        if (!current || (current.status !== 'open' && current.status !== 'in_progress')) return;
        await patch(task.id, endOf(outcome));
      }).catch((error: unknown) => {
        console.error(`task ${task.id} could not be finished`, error);
      });
      return linked ?? working ?? task;
    } catch (error) {
      return (await patch(task.id, { status: 'failed', result: errorMessage(error) })) ?? task;
    }
  }

  return {
    list(filter) {
      return repos.tasks.list(filter);
    },

    async get(id) {
      const task = await repos.tasks.get(id);
      if (!task) return undefined;
      return { ...task, children: await repos.tasks.listChildren(id) };
    },

    async create(input) {
      const data = CreateTask.parse(input);
      await admit(data.parentTaskId);
      const created = await repos.tasks.create(data);
      await bus.publish({ type: 'task.created', threadId: created.threadId, task: created });
      return startWork(created);
    },

    update: patch,
  };
}
