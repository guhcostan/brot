import { afterEach, describe, expect, it } from 'vitest';
import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import {
  TEAM_MAX_ASK_HOPS,
  TEAM_MAX_DEPTH,
  TEAM_MAX_TASKS_PER_CHAIN,
  type Bot,
  type CanonicalEvent,
  type Thread,
} from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { createEventBus, type EventBus } from '../bus';
import type { BrotTool, ToolResult } from '../mcp/types';
import { createTeamTools, type TeamDeps } from './index';
import type { BotRunOutcome, BotRunRequest, ChainRef, TeamRunner } from './types';

type EventOf<T extends CanonicalEvent['type']> = Extract<CanonicalEvent, { type: T }>;

interface FakeRunner extends TeamRunner {
  readonly runs: BotRunRequest[];
  readonly starts: BotRunRequest[];
  readonly chains: Map<string, ChainRef>;
  /** Each `linkBudget` call, as [chainId, budgetChainId]. */
  readonly links: Array<[string, string]>;
  onRun: (req: BotRunRequest) => Promise<BotRunOutcome>;
  failStart?: Error;
  /** How the runs started by `startBot` end at once. Unset, a started run keeps going until `finishStart` ends it. */
  startOutcome?: Omit<BotRunOutcome, 'runId'>;
  /** Ends the run started by `startBot` number `index` (1 for the first start). */
  finishStart(index: number, outcome: Omit<BotRunOutcome, 'runId'>): void;
}

/** A runner whose `startBot` runs are real run rows, so tasks can link them, and which the test ends by hand. */
function createFakeRunner(repos: Repos, spentUsd?: (chainId: string) => number): FakeRunner {
  const runs: BotRunRequest[] = [];
  const starts: BotRunRequest[] = [];
  const chains = new Map<string, ChainRef>();
  const links: Array<[string, string]> = [];
  const ends: Array<(outcome: Omit<BotRunOutcome, 'runId'>) => void> = [];
  const runner: FakeRunner = {
    runs,
    starts,
    chains,
    links,
    onRun: async () => ({ runId: 'run-target', status: 'completed', text: 'Ship it' }),
    async runBot(req) {
      runs.push(req);
      return runner.onRun(req);
    },
    async startBot(req) {
      starts.push(req);
      if (runner.failStart) throw runner.failStart;
      const run = await repos.runs.create({ threadId: req.threadId, botId: req.botId, engine: 'mock' });
      let resolveSettled!: (outcome: BotRunOutcome) => void;
      const settled = new Promise<BotRunOutcome>((resolve) => {
        resolveSettled = resolve;
      });
      ends.push((outcome) => resolveSettled({ runId: run.id, ...outcome }));
      if (runner.startOutcome) runner.finishStart(starts.length, runner.startOutcome);
      return { runId: run.id, settled };
    },
    finishStart(index, outcome) {
      ends[index - 1]?.(outcome);
    },
    chainOf(runId) {
      return chains.get(runId);
    },
    linkBudget(chainId, budgetChainId) {
      links.push([chainId, budgetChainId]);
    },
  };
  return spentUsd
    ? Object.assign(runner, { chainSpentUsd: spentUsd, chainCapUsd: (): number | undefined => undefined })
    : runner;
}

interface Fixture {
  repos: Repos;
  bus: EventBus;
  runner: FakeRunner;
  events: CanonicalEvent[];
  handoffs: Array<{ threadId: string; toBotId: string; eventsSoFar: number }>;
  tool(name: string): BrotTool;
  bot(name: string): Promise<Bot>;
  thread(bot: Bot): Promise<Thread>;
  scope(bot: Bot, thread: Thread, chain?: ChainRef): Promise<ApprovalScope>;
  close(): void;
}

let handle: BrotDb;

afterEach(() => {
  handle.client.close();
});

async function setup(options: { spentUsd?: (chainId: string) => number } = {}): Promise<Fixture> {
  handle = await createDb(':memory:');
  await migrate(handle.db);
  const repos = createRepos(handle.db);
  const bus = createEventBus(repos.events);
  const runner = createFakeRunner(repos, options.spentUsd);
  const events: CanonicalEvent[] = [];
  const handoffs: Fixture['handoffs'] = [];
  bus.subscribe((event) => events.push(event));

  const deps: TeamDeps = {
    repos,
    bus,
    runner,
    onHandoff: (threadId, toBotId) => {
      handoffs.push({ threadId, toBotId, eventsSoFar: events.length });
    },
  };
  const tools = new Map(createTeamTools(deps).map((tool) => [tool.spec.name, tool]));

  return {
    repos,
    bus,
    runner,
    events,
    handoffs,
    tool(name) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`no tool ${name}`);
      return tool;
    },
    bot(name) {
      return repos.bots.create({ name, job: `${name} job` });
    },
    thread(bot) {
      return repos.threads.create(bot.id, { title: 'Chat' });
    },
    async scope(bot, thread, chain) {
      const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
      if (chain) runner.chains.set(run.id, chain);
      return { botId: bot.id, threadId: thread.id, runId: run.id };
    },
    close() {
      handle.client.close();
    },
  };
}

/** Prepares and runs a call, the way the MCP server does once the broker allows it. */
async function invoke(tool: BrotTool, scope: ApprovalScope, args: Record<string, unknown>): Promise<ToolResult> {
  const prepared = await tool.prepare(scope, args);
  if ('error' in prepared) return { ok: false, output: prepared.error };
  return prepared.run({});
}

/** The error a call is refused with before any approval. Fails the test if the call is accepted. */
async function refusal(tool: BrotTool, scope: ApprovalScope, args: Record<string, unknown>): Promise<string> {
  const prepared = await tool.prepare(scope, args);
  if (!('error' in prepared)) throw new Error('expected the call to be refused');
  return prepared.error;
}

describe('list_team', () => {
  it('lists active bots with room members first', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const cy = await f.bot('Cy');
    const dee = await f.bot('Dee');
    await f.repos.bots.update(cy.id, { archived: true });
    const room = await f.repos.rooms.create({ title: 'Team', botIds: [dee.id, bo.id], leadBotId: dee.id, responder: 'lead' });

    const result = await invoke(f.tool('list_team'), await f.scope(ada, room), {});
    const team = JSON.parse(result.output) as Array<{ id: string; roomMember: boolean; you?: boolean; computer: string }>;

    expect(result.ok).toBe(true);
    expect(team.map((entry) => entry.id).slice(0, 2).sort()).toEqual([bo.id, dee.id].sort());
    expect(team.map((entry) => entry.id).at(-1)).toBe(ada.id);
    expect(team.map((entry) => entry.roomMember)).toEqual([true, true, false]);
    expect(team.find((entry) => entry.id === ada.id)?.you).toBe(true);
    expect(team[0]?.computer).toBe('sandbox');
  });

  it('omits room fields in a direct thread', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    const result = await invoke(f.tool('list_team'), await f.scope(ada, await f.thread(ada)), {});
    const team = JSON.parse(result.output) as Array<Record<string, unknown>>;
    expect(team).toHaveLength(2);
    expect(team[0]).not.toHaveProperty('roomMember');
  });
});

describe('ask_bot', () => {
  it('runs the target in the caller thread, returns its answer, and emits the events in order', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const thread = await f.thread(ada);
    const scope = await f.scope(ada, thread);

    const result = await invoke(f.tool('ask_bot'), scope, { botName: 'bo', question: 'Is the deck ready?' });

    expect(result).toEqual({ ok: true, output: 'Ship it' });
    expect(f.runner.runs).toHaveLength(1);
    expect(f.runner.runs[0]).toMatchObject({
      botId: bo.id,
      threadId: thread.id,
      fromBotId: ada.id,
      chain: { depth: 0, askHops: 1 },
    });
    expect(f.runner.runs[0]?.input).toContain('Is the deck ready?');

    const messages = await f.repos.messages.listByThread(thread.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'assistant', authorBotId: ada.id, viaBotId: bo.id, content: 'Is the deck ready?' });

    expect(f.events.map((event) => event.type)).toEqual(['bot.asked', 'message.completed', 'bot.answered']);
    const asked = f.events[0] as EventOf<'bot.asked'>;
    const answered = f.events[2] as EventOf<'bot.answered'>;
    expect(asked).toMatchObject({ fromBotId: ada.id, toBotId: bo.id, question: 'Is the deck ready?' });
    expect(answered).toMatchObject({ askId: asked.askId, answer: 'Ship it' });
  });

  it('refuses a call that names the caller itself', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const scope = await f.scope(ada, await f.thread(ada));
    expect(await refusal(f.tool('ask_bot'), scope, { botId: ada.id, question: 'Hi' })).toMatch(/cannot ask itself/);
    expect(await refusal(f.tool('ask_bot'), scope, { botName: 'ADA', question: 'Hi' })).toMatch(/cannot ask itself/);
  });

  it('refuses an unknown or ambiguous bot name before any approval', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Twin');
    await f.bot('Twin');
    const scope = await f.scope(ada, await f.thread(ada));

    expect(await refusal(f.tool('ask_bot'), scope, { botName: 'Nobody', question: 'Hi' })).toMatch(/No active bot is named "Nobody"/);
    expect(await refusal(f.tool('ask_bot'), scope, { botName: 'twin', question: 'Hi' })).toMatch(/matches 2 bots/);
    expect(await refusal(f.tool('ask_bot'), scope, { botId: 'bot_missing', question: 'Hi' })).toMatch(/No active bot/);
    expect(f.runner.runs).toHaveLength(0);
  });

  it('refuses a question that would pass the hop limit', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    const thread = await f.thread(ada);

    const atLimit = await f.scope(ada, thread, { chainId: 'chain-full', depth: 0, askHops: TEAM_MAX_ASK_HOPS });
    expect(await refusal(f.tool('ask_bot'), atLimit, { botName: 'Bo', question: 'Deeper?' })).toMatch(/hop 5/);

    const underLimit = await f.scope(ada, thread, { chainId: 'chain-open', depth: 0, askHops: TEAM_MAX_ASK_HOPS - 1 });
    expect(await invoke(f.tool('ask_bot'), underLimit, { botName: 'Bo', question: 'Last hop' })).toEqual({ ok: true, output: 'Ship it' });
    expect(f.runner.runs.at(-1)?.chain).toEqual({ chainId: 'chain-open', depth: 0, askHops: TEAM_MAX_ASK_HOPS });
  });

  it('refuses a question that would loop back into the ask path, and frees the path afterwards', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const thread = await f.thread(ada);
    const adaScope = await f.scope(ada, thread);
    let loopRefusal: string | undefined;

    f.runner.onRun = async (req) => {
      const boScope = await f.scope(bo, thread, req.chain);
      loopRefusal = await refusal(f.tool('ask_bot'), boScope, { botName: 'Ada', question: 'Back to you' });
      return { runId: 'run-bo', status: 'completed', text: 'Pondered' };
    };
    expect(await invoke(f.tool('ask_bot'), adaScope, { botName: 'Bo', question: 'Hi' })).toEqual({ ok: true, output: 'Pondered' });
    expect(loopRefusal).toMatch(/would loop/);

    f.runner.onRun = async () => ({ runId: 'run-bo', status: 'completed', text: 'Again' });
    expect(await invoke(f.tool('ask_bot'), adaScope, { botName: 'Bo', question: 'Again?' })).toEqual({ ok: true, output: 'Again' });
  });

  it('stops new questions once the chain budget is spent, when the runner reports spend', async () => {
    const spent = await setup({ spentUsd: () => 1 });
    const ada = await spent.bot('Ada');
    const bo = await spent.bot('Bo');
    await spent.repos.bots.update(bo.id, { teamBudgetUsd: 1 });
    const scope = await spent.scope(ada, await spent.thread(ada), { chainId: 'chain-budget', depth: 0, askHops: 0 });
    expect(await refusal(spent.tool('ask_bot'), scope, { botName: 'Bo', question: 'Hi' })).toMatch(/budget/);
    spent.close();

    const untracked = await setup();
    const cara = await untracked.bot('Ada');
    const bob = await untracked.bot('Bo');
    await untracked.repos.bots.update(bob.id, { teamBudgetUsd: 0 });
    const plain = await untracked.scope(cara, await untracked.thread(cara), { chainId: 'chain-plain', depth: 0, askHops: 0 });
    expect(await invoke(untracked.tool('ask_bot'), plain, { botName: 'Bo', question: 'Hi' })).toEqual({ ok: true, output: 'Ship it' });
  });

  it('truncates a long answer and says so', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    f.runner.onRun = async () => ({ runId: 'run-bo', status: 'completed', text: 'x'.repeat(9000) });
    const result = await invoke(f.tool('ask_bot'), await f.scope(ada, await f.thread(ada)), { botName: 'Bo', question: 'Long?' });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('[Answer truncated: showing the first 8000 of 9000 characters.]');
    expect(result.output.length).toBeLessThan(9000);
  });

  it('reports a target that did not answer as a failure and still closes the exchange', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    f.runner.onRun = async () => ({ runId: 'run-bo', status: 'failed', text: '', error: 'engine offline' });
    const result = await invoke(f.tool('ask_bot'), await f.scope(ada, await f.thread(ada)), { botName: 'Bo', question: 'Hi' });

    expect(result.ok).toBe(false);
    expect(result.output).toContain('engine offline');
    expect(f.events.at(-1)?.type).toBe('bot.answered');
  });
});

describe('delegate_task', () => {
  it('creates the task, starts it in the assignee DM thread, and returns the task id', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const thread = await f.thread(ada);

    const result = await invoke(f.tool('delegate_task'), await f.scope(ada, thread), {
      botName: 'Bo',
      title: 'Draft copy',
      description: 'Two paragraphs',
    });

    const [task] = await f.repos.tasks.list({ assigneeBotId: bo.id });
    expect(task).toMatchObject({
      title: 'Draft copy',
      description: 'Two paragraphs',
      status: 'in_progress',
      createdByBotId: ada.id,
      createdByUser: false,
      depth: 1,
      threadId: thread.id,
    });
    expect(result).toEqual({ ok: true, output: expect.stringContaining(task?.id ?? 'missing') });

    const [dm] = await f.repos.threads.listByBot(bo.id, { kind: 'dm' });
    expect(task?.workThreadId).toBe(dm?.id);
    expect(f.runner.starts).toHaveLength(1);
    expect(f.runner.starts[0]).toMatchObject({
      botId: bo.id,
      threadId: dm?.id,
      fromBotId: ada.id,
      chain: { chainId: task?.chainId, depth: 1, askHops: 0 },
    });
    expect(f.runner.starts[0]?.input).toContain(task?.id ?? 'missing');
    expect(f.runner.starts[0]?.input).toContain('update_my_task');

    expect(f.events.map((event) => event.type)).toEqual(['task.created', 'task.updated']);
  });

  it('reuses the assignee existing DM thread', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const existing = await f.repos.threads.create(bo.id, { title: 'Chat' });

    await invoke(f.tool('delegate_task'), await f.scope(ada, await f.thread(ada)), { botName: 'Bo', title: 'Check' });

    expect(f.runner.starts[0]?.threadId).toBe(existing.id);
    expect(await f.repos.threads.listByBot(bo.id, { kind: 'dm' })).toHaveLength(1);
  });

  it('refuses to delegate to the caller itself', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const scope = await f.scope(ada, await f.thread(ada));
    expect(await refusal(f.tool('delegate_task'), scope, { botId: ada.id, title: 'Self' })).toMatch(/cannot delegate a task to itself/);
  });

  it('refuses a delegation that would pass the depth limit, named or implicit', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const cy = await f.bot('Cy');
    const dee = await f.bot('Dee');
    const thread = await f.thread(ada);
    const root = await f.repos.tasks.create({ title: 'Root', assigneeBotId: ada.id, threadId: thread.id });
    const one = await f.repos.tasks.create({ title: 'One', assigneeBotId: bo.id, threadId: thread.id, createdByBotId: ada.id, parentTaskId: root.id });
    const two = await f.repos.tasks.create({ title: 'Two', assigneeBotId: cy.id, threadId: thread.id, createdByBotId: bo.id, parentTaskId: one.id });
    const three = await f.repos.tasks.create({ title: 'Three', assigneeBotId: dee.id, threadId: thread.id, createdByBotId: cy.id, parentTaskId: two.id });
    expect(three.depth).toBe(TEAM_MAX_DEPTH);

    const deepScope = await f.scope(dee, thread, { chainId: root.chainId, depth: TEAM_MAX_DEPTH, askHops: 0 });
    expect(await refusal(f.tool('delegate_task'), deepScope, { botName: 'Ada', title: 'Too deep', parentTaskId: three.id })).toMatch(
      /at most depth 3/,
    );
    expect(await refusal(f.tool('delegate_task'), deepScope, { botName: 'Ada', title: 'Too deep' })).toMatch(/at most depth 3/);

    const midScope = await f.scope(cy, thread, { chainId: root.chainId, depth: 2, askHops: 0 });
    expect(await invoke(f.tool('delegate_task'), midScope, { botName: 'Dee', title: 'Last level' })).toMatchObject({ ok: true });
    expect((await f.repos.tasks.list({ assigneeBotId: dee.id })).at(-1)?.depth).toBe(TEAM_MAX_DEPTH);
  });

  it('refuses a named parent outside the caller chain or a parent that does not exist', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const thread = await f.thread(ada);
    const root = await f.repos.tasks.create({ title: 'Root', assigneeBotId: bo.id, threadId: thread.id });
    const scope = await f.scope(ada, thread);
    expect(await refusal(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Child', parentTaskId: root.id })).toMatch(
      /not in your chain/,
    );
    expect(await refusal(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Child', parentTaskId: 'task_missing' })).toMatch(
      /No task has the id/,
    );
  });

  it('refuses a delegation into a full chain', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const thread = await f.thread(ada);
    const root = await f.repos.tasks.create({ title: 'Root', assigneeBotId: ada.id, threadId: thread.id });
    for (let index = 0; index < TEAM_MAX_TASKS_PER_CHAIN - 1; index += 1) {
      await f.repos.tasks.create({ title: `Child ${index}`, assigneeBotId: bo.id, threadId: thread.id, createdByBotId: ada.id, parentTaskId: root.id });
    }
    const scope = await f.scope(ada, thread, { chainId: root.chainId, depth: 0, askHops: 0 });
    expect(await refusal(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'One more' })).toMatch(
      `already holds ${TEAM_MAX_TASKS_PER_CHAIN} tasks`,
    );
  });

  it('refuses a delegation once the chain budget is spent', async () => {
    const f = await setup({ spentUsd: () => 2 });
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    await f.repos.bots.update(ada.id, { teamBudgetUsd: 2 });
    const scope = await f.scope(ada, await f.thread(ada), { chainId: 'chain-spent', depth: 0, askHops: 0 });
    expect(await refusal(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Spent' })).toMatch(/budget/);
    expect(await f.repos.tasks.list({ assigneeBotId: bo.id })).toHaveLength(0);
  });

  it('keeps two delegations from the same run in the caller chain', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const cy = await f.bot('Cy');
    const thread = await f.thread(ada);
    const scope = await f.scope(ada, thread, { chainId: 'lead-chain', depth: 0, askHops: 0 });

    expect(await invoke(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'First' })).toMatchObject({ ok: true });
    expect(await invoke(f.tool('delegate_task'), scope, { botName: 'Cy', title: 'Second' })).toMatchObject({ ok: true });

    const tasks = await f.repos.tasks.list({ chainId: 'lead-chain' });
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.chainId)).toEqual(['lead-chain', 'lead-chain']);
    expect(tasks.map((task) => task.assigneeBotId).sort()).toEqual([bo.id, cy.id].sort());
    expect(tasks.every((task) => task.depth === 1)).toBe(true);
    // Same chain as the caller, so no separate task chain needs a budget link.
    expect(f.runner.links).toEqual([]);
    expect(f.runner.starts.map((start) => start.chain?.chainId)).toEqual(['lead-chain', 'lead-chain']);
  });

  it('joins the parent chain when a parentTaskId is named', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const cy = await f.bot('Cy');
    const thread = await f.thread(ada);
    const root = await f.repos.tasks.create({ title: 'Root', assigneeBotId: ada.id, threadId: thread.id });
    const parent = await f.repos.tasks.create({
      title: 'Parent',
      assigneeBotId: ada.id,
      threadId: thread.id,
      createdByBotId: bo.id,
      parentTaskId: root.id,
    });
    const scope = await f.scope(ada, thread, { chainId: root.chainId, depth: 1, askHops: 0 });

    expect(
      await invoke(f.tool('delegate_task'), scope, { botName: 'Cy', title: 'Child', parentTaskId: parent.id }),
    ).toMatchObject({ ok: true });

    const [child] = await f.repos.tasks.list({ assigneeBotId: cy.id });
    expect(child).toMatchObject({ chainId: root.chainId, parentTaskId: parent.id, depth: 2 });
  });

  it('keeps delegations from different runs in their own chains', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    const thread = await f.thread(ada);

    await invoke(f.tool('delegate_task'), await f.scope(ada, thread, { chainId: 'run-one', depth: 0, askHops: 0 }), {
      botName: 'Bo',
      title: 'From one',
    });
    await invoke(f.tool('delegate_task'), await f.scope(ada, thread, { chainId: 'run-two', depth: 0, askHops: 0 }), {
      botName: 'Bo',
      title: 'From two',
    });

    const chains = (await f.repos.tasks.list({ assigneeBotId: (await f.repos.bots.list()).find((bot) => bot.name === 'Bo')?.id })).map(
      (task) => task.chainId,
    );
    expect(chains).toEqual(['run-one', 'run-two']);
  });

  it('enforces the chain task limit across delegations from one run', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    const cy = await f.bot('Cy');
    const thread = await f.thread(ada);
    const root = await f.repos.tasks.create({ title: 'Root', assigneeBotId: ada.id, threadId: thread.id });
    for (let index = 0; index < TEAM_MAX_TASKS_PER_CHAIN - 2; index += 1) {
      await f.repos.tasks.create({
        title: `Filler ${index}`,
        assigneeBotId: cy.id,
        threadId: thread.id,
        createdByBotId: ada.id,
        parentTaskId: root.id,
      });
    }
    const scope = await f.scope(ada, thread, { chainId: root.chainId, depth: 0, askHops: 0 });

    expect(await invoke(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Last slot' })).toMatchObject({ ok: true });
    expect(await refusal(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Over the limit' })).toMatch(
      `already holds ${TEAM_MAX_TASKS_PER_CHAIN} tasks`,
    );
  });

  it('stops the second delegation when the shared chain budget is spent', async () => {
    let spent = 0;
    const f = await setup({ spentUsd: () => spent });
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    await f.repos.bots.update(ada.id, { teamBudgetUsd: 2 });
    const scope = await f.scope(ada, await f.thread(ada), { chainId: 'budget-chain', depth: 0, askHops: 0 });

    expect(await invoke(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'First' })).toMatchObject({ ok: true });
    spent = 2;
    expect(await refusal(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Second' })).toMatch(/budget/);
    expect(await f.repos.tasks.list({ chainId: 'budget-chain' })).toHaveLength(1);
  });

  it('marks the task failed when the assignee cannot be started', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    f.runner.failStart = new Error('engine offline');

    const result = await invoke(f.tool('delegate_task'), await f.scope(ada, await f.thread(ada)), { botName: 'Bo', title: 'Stalled' });

    expect(result).toEqual({ ok: false, output: 'Could not start Bo: engine offline' });
    const [task] = await f.repos.tasks.list({ assigneeBotId: bo.id });
    expect(task).toMatchObject({ status: 'failed', result: 'Could not start Bo: engine offline' });
    expect(f.events.map((event) => event.type)).toEqual(['task.created', 'task.updated', 'task.updated']);
  });
});

/** Resolves with the first value the read returns, polling until one exists. */
async function eventually<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for condition');
}

describe('update_my_task', () => {
  async function delegatedTask() {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const adaThread = await f.thread(ada);
    const task = await f.repos.tasks.create({
      title: 'Draft copy',
      assigneeBotId: bo.id,
      threadId: adaThread.id,
      createdByBotId: ada.id,
    });
    const boDm = await f.thread(bo);
    return { f, ada, bo, adaThread, task, boScope: await f.scope(bo, boDm, { chainId: task.chainId, depth: 1, askHops: 0 }) };
  }

  it('refuses an update from a bot that is not the assignee', async () => {
    const { f, ada, task } = await delegatedTask();
    const adaScope = await f.scope(ada, await f.thread(ada));
    expect(await refusal(f.tool('update_my_task'), adaScope, { taskId: task.id, status: 'done', result: 'mine' })).toMatch(
      /Only its assignee/,
    );
  });

  it('posts a finished result to the origin thread and notifies the delegator once', async () => {
    const { f, ada, bo, adaThread, task, boScope } = await delegatedTask();

    const result = await invoke(f.tool('update_my_task'), boScope, { taskId: task.id, status: 'done', result: 'Two paragraphs ready' });

    expect(result).toEqual({ ok: true, output: `Task ${task.id} is done. Ada was notified and will continue from the result.` });
    const posted = (await f.repos.messages.listByThread(adaThread.id)).at(-1);
    expect(posted).toMatchObject({ role: 'assistant', authorBotId: bo.id, viaBotId: ada.id });
    expect(posted?.content).toContain('Two paragraphs ready');

    expect(f.runner.starts).toHaveLength(1);
    expect(f.runner.starts[0]).toMatchObject({ botId: ada.id, threadId: adaThread.id, fromBotId: bo.id, chain: { depth: 0 } });
    expect(f.runner.starts[0]?.input).toContain('Two paragraphs ready');

    expect(await refusal(f.tool('update_my_task'), boScope, { taskId: task.id, status: 'done', result: 'again' })).toMatch(/already done/);
    expect(f.runner.starts).toHaveLength(1);

    expect(f.events.map((event) => event.type)).toEqual(['task.updated', 'message.completed']);
  });

  it('records in the origin thread when the delegator cannot be started', async () => {
    const { f, adaThread, task, boScope } = await delegatedTask();
    f.runner.failStart = new Error('engine offline');

    const result = await invoke(f.tool('update_my_task'), boScope, { taskId: task.id, status: 'done', result: 'Two paragraphs ready' });

    expect(result).toEqual({ ok: true, output: `Task ${task.id} is done.` });
    expect((await f.repos.messages.listByThread(adaThread.id)).at(-1)).toMatchObject({
      role: 'system',
      content: 'Ada could not continue from task "Draft copy" (done): engine offline',
    });
  });

  it('records in the origin thread when the delegator run ends without continuing', async () => {
    const { f, adaThread, task, boScope } = await delegatedTask();
    f.runner.startOutcome = { status: 'failed', text: '', error: 'model down' };

    await invoke(f.tool('update_my_task'), boScope, { taskId: task.id, status: 'done', result: 'Two paragraphs ready' });

    const notice = await eventually(async () =>
      (await f.repos.messages.listByThread(adaThread.id)).find((message) => message.role === 'system'),
    );
    expect(notice.content).toBe('Ada could not continue from task "Draft copy" (done): model down');
  });

  it('posts a failure without notifying when the delegator is over budget', async () => {
    const f = await setup({ spentUsd: () => 1 });
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    await f.repos.bots.update(ada.id, { teamBudgetUsd: 1 });
    const adaThread = await f.thread(ada);
    const task = await f.repos.tasks.create({ title: 'Draft copy', assigneeBotId: bo.id, threadId: adaThread.id, createdByBotId: ada.id });
    const scope = await f.scope(bo, await f.thread(bo), { chainId: task.chainId, depth: 1, askHops: 0 });

    const result = await invoke(f.tool('update_my_task'), scope, { taskId: task.id, status: 'failed', result: 'No access' });

    expect(result).toEqual({ ok: true, output: `Task ${task.id} is failed.` });
    expect((await f.repos.messages.listByThread(adaThread.id)).at(-1)?.content).toContain('No access');
    expect(f.runner.starts).toHaveLength(0);
  });

  it('reports progress without posting a message or notifying anyone', async () => {
    const { f, task, boScope } = await delegatedTask();

    const result = await invoke(f.tool('update_my_task'), boScope, { taskId: task.id, status: 'in_progress' });

    expect(result).toEqual({ ok: true, output: `Task ${task.id} is in_progress.` });
    expect((await f.repos.tasks.get(task.id))?.status).toBe('in_progress');
    expect(f.runner.starts).toHaveLength(0);
    expect(f.events.map((event) => event.type)).toEqual(['task.updated']);
  });

  it('refuses an update to a task that already ended', async () => {
    const { f, task, boScope } = await delegatedTask();
    await invoke(f.tool('update_my_task'), boScope, { taskId: task.id, status: 'failed', result: 'Stuck' });
    expect(await refusal(f.tool('update_my_task'), boScope, { taskId: task.id, status: 'in_progress' })).toMatch(/already failed/);
  });

  it('posts a user task result without notifying anyone', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const thread = await f.thread(ada);
    const task = await f.repos.tasks.create({ title: 'User ask', assigneeBotId: bo.id, threadId: thread.id });
    const scope = await f.scope(bo, await f.thread(bo), { chainId: task.chainId, depth: 0, askHops: 0 });

    await invoke(f.tool('update_my_task'), scope, { taskId: task.id, status: 'done', result: 'Here it is' });

    expect((await f.repos.messages.listByThread(thread.id)).at(-1)).toMatchObject({ authorBotId: bo.id, content: expect.stringContaining('Here it is') });
    expect(f.runner.starts).toHaveLength(0);
  });
});

describe('handoff', () => {
  it('refuses outside a room', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    const scope = await f.scope(ada, await f.thread(ada));
    expect(await refusal(f.tool('handoff'), scope, { botName: 'Bo' })).toMatch(/only works in a room/);
    expect(f.handoffs).toHaveLength(0);
  });

  it('refuses a target that is not a room member, and the caller itself', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    await f.bot('Cy');
    const room = await f.repos.rooms.create({ title: 'Team', botIds: [ada.id, bo.id], leadBotId: ada.id, responder: 'lead' });
    const scope = await f.scope(ada, room);
    expect(await refusal(f.tool('handoff'), scope, { botName: 'Cy' })).toMatch(/not a member/);
    expect(await refusal(f.tool('handoff'), scope, { botName: 'Ada' })).toMatch(/cannot hand the room to itself/);
  });

  it('stores the next responder before emitting the handoff event', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const room = await f.repos.rooms.create({ title: 'Team', botIds: [ada.id, bo.id], leadBotId: ada.id, responder: 'lead' });
    const scope = await f.scope(ada, room);

    const result = await invoke(f.tool('handoff'), scope, { botName: 'Bo', note: 'Your turn' });

    expect(result).toEqual({ ok: true, output: 'The room is handed to Bo, who answers next.' });
    expect(f.handoffs).toEqual([{ threadId: room.id, toBotId: bo.id, eventsSoFar: 0 }]);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ type: 'handoff', threadId: room.id, fromBotId: ada.id, toBotId: bo.id, note: 'Your turn' });
  });
});

describe('per-run call limits', () => {
  it('refuses a tool past its limit within one run, and starts every run with fresh limits', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    await f.bot('Bo');
    const thread = await f.thread(ada);
    const scope = await f.scope(ada, thread);

    expect(await invoke(f.tool('list_team'), scope, {})).toMatchObject({ ok: true });
    expect(await refusal(f.tool('list_team'), scope, {})).toMatch(/list_team is used up for this run \(at most 1 calls per run\)/);

    for (let call = 0; call < 3; call += 1) {
      expect(await invoke(f.tool('ask_bot'), scope, { botName: 'Bo', question: `Question ${call}` })).toMatchObject({ ok: true });
    }
    expect(await refusal(f.tool('ask_bot'), scope, { botName: 'Bo', question: 'One more' })).toMatch(/ask_bot is used up/);
    expect(f.runner.runs).toHaveLength(3);

    const next = await f.scope(ada, thread);
    expect(await invoke(f.tool('list_team'), next, {})).toMatchObject({ ok: true });
  });

  it('caps delegations at six per run and refuses the seventh before anything is created', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const scope = await f.scope(ada, await f.thread(ada));
    for (let index = 0; index < 6; index += 1) {
      expect(await invoke(f.tool('delegate_task'), scope, { botName: 'Bo', title: `Task ${index}` })).toMatchObject({ ok: true });
    }
    expect(await refusal(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Seventh' })).toMatch(/delegate_task is used up/);
    expect(await f.repos.tasks.list({ assigneeBotId: bo.id })).toHaveLength(6);
  });
});

describe('delegated task settlement', () => {
  /** Delegates from Ada to Bo and returns the task, with the scope Bo's work run would use. */
  async function delegated(f: Fixture) {
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const thread = await f.thread(ada);
    expect(await invoke(f.tool('delegate_task'), await f.scope(ada, thread), { botName: 'Bo', title: 'Draft copy' })).toMatchObject({
      ok: true,
    });
    const task = await eventually(async () => (await f.repos.tasks.list({ assigneeBotId: bo.id }))[0]);
    return { ada, bo, thread, task };
  }

  /** Waits for the delegator's notice run to start, then gives the event loop a few turns to show any second one. */
  async function noticesAfter(f: Fixture, expected: number): Promise<void> {
    await eventually(async () => (f.runner.starts.length >= expected ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.runner.starts).toHaveLength(expected);
  }

  it('ends the task with the run output and notifies the delegator once, when the assignee never reports', async () => {
    const f = await setup();
    const { ada, bo, thread, task } = await delegated(f);
    expect(task?.status).toBe('in_progress');
    expect(task?.workRunId).toEqual(expect.any(String));

    f.runner.finishStart(1, { status: 'completed', text: 'Two paragraphs' });

    await noticesAfter(f, 2);
    const ended = await f.repos.tasks.get(task!.id);
    expect(ended).toMatchObject({ status: 'done', result: 'Two paragraphs' });
    expect(f.runner.starts[1]).toMatchObject({ botId: ada.id, threadId: thread.id, fromBotId: bo.id, chain: { depth: 0 } });
    expect(f.runner.starts[1]?.input).toContain('Two paragraphs');
    expect(f.runner.starts[1]?.input).toContain('is done');
    const posted = (await f.repos.messages.listByThread(thread.id)).at(-1);
    expect(posted).toMatchObject({ authorBotId: bo.id, viaBotId: ada.id, content: expect.stringContaining('**Task done: Draft copy**') });
  });

  it('does not notify again when the assignee reported on its task before its run settled', async () => {
    const f = await setup();
    const { bo, task } = await delegated(f);
    const boScope = await f.scope(bo, await f.thread(bo));

    expect(await invoke(f.tool('update_my_task'), boScope, { taskId: task!.id, status: 'done', result: 'Reported' })).toMatchObject({
      ok: true,
    });
    await noticesAfter(f, 2);

    f.runner.finishStart(1, { status: 'completed', text: 'Same result, later' });
    await noticesAfter(f, 2);
    expect(await f.repos.tasks.get(task!.id)).toMatchObject({ status: 'done', result: 'Reported' });
  });

  it('fails the task with the reason when its run fails, and still notifies the delegator once', async () => {
    const f = await setup();
    const { task } = await delegated(f);

    f.runner.finishStart(1, { status: 'failed', text: '', error: 'model down' });

    await noticesAfter(f, 2);
    expect(await f.repos.tasks.get(task!.id)).toMatchObject({ status: 'failed', result: 'model down' });
    expect(f.runner.starts[1]?.input).toContain('is failed');
  });
});

describe('delegated work and the caller budget', () => {
  it('puts a task delegated from a run into the chain that run is in', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    const scope = await f.scope(ada, await f.thread(ada), { chainId: 'room-chain', depth: 0, askHops: 0 });

    expect(await invoke(f.tool('delegate_task'), scope, { botName: 'Bo', title: 'Work' })).toMatchObject({ ok: true });

    const [task] = await f.repos.tasks.list({ assigneeBotId: bo.id });
    expect(task?.chainId).toBe('room-chain');
    // Already in the caller's chain, so nothing has to be linked for the budget.
    expect(f.runner.links).toEqual([]);
    expect(f.runner.starts[0]?.chain).toMatchObject({ chainId: 'room-chain', depth: 1 });
  });

  it('gives a delegation from an unchained run its own chain', async () => {
    const f = await setup();
    const ada = await f.bot('Ada');
    const bo = await f.bot('Bo');
    await invoke(f.tool('delegate_task'), await f.scope(ada, await f.thread(ada)), { botName: 'Bo', title: 'Loose' });

    const [task] = await f.repos.tasks.list({ assigneeBotId: bo.id });
    expect(task?.chainId).toBe(task?.id);
    expect(f.runner.links).toEqual([]);
  });
});
