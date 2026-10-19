import type { EngineRegistry } from '@brot/engines';
import type { Repos } from '@brot/db';
import type { Bot, EngineDriver, EngineEvent, Message, Run, RunContext, ToolDecision, ToolRequest } from '@brot/protocol';
import type { Broker } from './broker';
import type { EventBus } from './bus';

export interface Harness {
  startRun(threadId: string, input: string): Promise<{ runId: string }>;
  cancelRun(runId: string): Promise<Run | undefined>;
  cancelBotRuns(botId: string): Promise<void>;
  /** Marks runs left open by a previous process as failed. Call once at boot. */
  recoverInterruptedRuns(): Promise<number>;
  /** Aborts in-flight runs without writing state, so the next boot recovers them. */
  shutdown(): void;
}

interface ActiveRun {
  runId: string;
  threadId: string;
  botId: string;
  messageId: string;
  controller: AbortController;
  text: string;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
  /** Set by the first terminal write, so completion, failure and cancellation cannot all write. */
  settled: boolean;
}

type TerminalStatus = 'completed' | 'failed' | 'cancelled';

export function createHarness(deps: {
  repos: Repos;
  bus: EventBus;
  broker: Broker;
  engines: EngineRegistry;
}): Harness {
  const { repos, bus, broker, engines } = deps;
  const active = new Map<string, ActiveRun>();

  async function startRun(threadId: string, input: string): Promise<{ runId: string }> {
    const thread = await repos.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} does not exist`);
    const bot = await repos.bots.get(thread.botId);
    if (!bot) throw new Error(`Bot ${thread.botId} does not exist`);

    const history = await repos.messages.listByThread(threadId);
    const userMessage = await repos.messages.create({ threadId, role: 'user', content: input });
    await bus.publish({ type: 'message.completed', threadId, message: userMessage });

    const run = await repos.runs.create({ threadId, botId: bot.id, engine: bot.engine, model: bot.model });
    await bus.publish({
      type: 'run.started',
      threadId,
      runId: run.id,
      botId: bot.id,
      engine: bot.engine,
      model: bot.model,
    });

    const state: ActiveRun = {
      runId: run.id,
      threadId,
      botId: bot.id,
      messageId: crypto.randomUUID(),
      controller: new AbortController(),
      text: '',
      usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      settled: false,
    };
    active.set(run.id, state);
    void execute(state, bot, history, input).catch((error: unknown) => {
      console.error(`run ${run.id} could not be finalized`, error);
    });
    return { runId: run.id };
  }

  async function execute(state: ActiveRun, bot: Bot, history: Message[], input: string): Promise<void> {
    try {
      const driver = await readyDriver(bot);
      const ctx: RunContext = {
        runId: state.runId,
        threadId: state.threadId,
        bot,
        history,
        input,
        memories: await repos.memories.listByBot(bot.id),
        skills: await repos.skills.listForBot(bot.id),
        signal: state.controller.signal,
        requestTool: (req) => requestTool(state, req),
      };
      for await (const event of driver.run(ctx)) {
        if (state.controller.signal.aborted) break;
        await handleEvent(state, bot, event);
      }
      if (state.controller.signal.aborted) return;
      await complete(state);
    } catch (error) {
      if (state.controller.signal.aborted) return;
      await settle(state, 'failed', errorMessage(error));
    } finally {
      active.delete(state.runId);
    }
  }

  async function readyDriver(bot: Bot): Promise<EngineDriver> {
    const driver = engines.get(bot.engine);
    if (!driver) throw new Error(`Engine "${bot.engine}" is not registered on this server`);
    const availability = await driver.detect();
    if (!availability.available) {
      throw new Error(`Engine "${bot.engine}" is unavailable${availability.reason ? `: ${availability.reason}` : ''}`);
    }
    return driver;
  }

  function requestTool(state: ActiveRun, req: ToolRequest): Promise<ToolDecision> {
    if (state.controller.signal.aborted) {
      return Promise.resolve({ allowed: false, reply: 'Run was cancelled.' });
    }
    return broker.request({ botId: state.botId, threadId: state.threadId, runId: state.runId }, req);
  }

  async function handleEvent(state: ActiveRun, bot: Bot, event: EngineEvent): Promise<void> {
    const { threadId, runId } = state;
    switch (event.type) {
      case 'text.delta':
        state.text += event.delta;
        await bus.publish({ type: 'message.delta', threadId, runId, messageId: state.messageId, delta: event.delta });
        return;
      case 'tool.call':
        await bus.publish({ type: 'tool.call', threadId, runId, callId: event.callId, tool: event.tool, args: event.args });
        return;
      case 'tool.result':
        await bus.publish({ type: 'tool.result', threadId, runId, callId: event.callId, ok: event.ok, output: event.output });
        return;
      case 'usage':
        state.usage.tokensIn += event.tokensIn;
        state.usage.tokensOut += event.tokensOut;
        state.usage.costUsd += event.costUsd;
        await repos.runs.update(runId, { ...state.usage });
        // cost.updated carries run totals, matching what the run row stores.
        await bus.publish({ type: 'cost.updated', threadId, runId, ...state.usage });
        return;
      case 'memory': {
        const memory = await repos.memories.create(bot.id, {
          kind: event.kind,
          content: event.content,
          sourceRunId: runId,
        });
        await bus.publish({ type: 'memory.written', threadId, runId, memory });
        return;
      }
    }
  }

  async function complete(state: ActiveRun): Promise<void> {
    if (state.settled) return;
    const message = await repos.messages.create({
      id: state.messageId,
      threadId: state.threadId,
      role: 'assistant',
      content: state.text,
    });
    await bus.publish({ type: 'message.completed', threadId: state.threadId, runId: state.runId, message });
    await settle(state, 'completed');
  }

  /** Writes the run's terminal status and event. Only the first call has any effect. */
  async function settle(state: ActiveRun, status: TerminalStatus, error?: string): Promise<void> {
    if (state.settled) return;
    state.settled = true;
    const { threadId, runId } = state;
    await repos.runs.update(runId, { status, endedAt: new Date().toISOString(), error });
    if (status === 'completed') {
      await repos.threads.touch(threadId);
      await bus.publish({ type: 'run.completed', threadId, runId });
    } else {
      // The protocol has no run.cancelled event yet, so a cancelled run is reported as run.failed.
      await bus.publish({ type: 'run.failed', threadId, runId, error: error ?? 'Run cancelled.' });
    }
  }

  async function cancelRun(runId: string): Promise<Run | undefined> {
    const run = await repos.runs.get(runId);
    if (!run) return undefined;
    const state = active.get(runId);
    if (!state || state.settled) return run;
    state.controller.abort();
    await broker.cancelRun(runId);
    await settle(state, 'cancelled');
    return repos.runs.get(runId);
  }

  async function cancelBotRuns(botId: string): Promise<void> {
    for (const state of [...active.values()]) {
      if (state.botId === botId) await cancelRun(state.runId);
    }
  }

  async function recoverInterruptedRuns(): Promise<number> {
    let recovered = 0;
    for (const bot of await repos.bots.list({ includeArchived: true })) {
      for (const thread of await repos.threads.listByBot(bot.id)) {
        for (const run of await repos.runs.listByThread(thread.id)) {
          if (run.status !== 'running' && run.status !== 'waiting_approval') continue;
          await repos.runs.update(run.id, {
            status: 'failed',
            error: 'server restarted',
            endedAt: new Date().toISOString(),
          });
          await bus.publish({ type: 'run.failed', threadId: thread.id, runId: run.id, error: 'server restarted' });
          recovered += 1;
        }
      }
    }
    return recovered;
  }

  function shutdown(): void {
    for (const state of active.values()) state.controller.abort();
  }

  return { startRun, cancelRun, cancelBotRuns, recoverInterruptedRuns, shutdown };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
