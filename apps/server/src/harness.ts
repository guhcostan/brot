import { createHash } from 'node:crypto';
import type { Repos } from '@brot/db';
import { modelHostsFor, type EngineRegistry } from '@brot/engines';
import type {
  Bot,
  ComputerHandle,
  ComputerKind,
  ComputerState,
  EngineDriver,
  EngineEvent,
  LlmRoute,
  Message,
  Run,
  RunContext,
  ToolDecision,
  ToolRequest,
} from '@brot/protocol';
import type { Broker } from './broker';
import type { EventBus } from './bus';
import type { ComputerProvider } from './computers/types';
import type { ServerMode } from './config';
import type { LlmRelay, ResolvedRoute, RunUsage } from './llm';
import type { BrotMcp } from './mcp/types';
import type { ChainLedger } from './rooms/chains';
import { buildTurn } from './rooms/context';
import type { BotRunOutcome, BotRunRequest } from './team/types';

/** Providers by the computer kind they serve. A `none` bot has no computer, so it has no entry. */
export type ComputerProviders = Partial<Record<Exclude<ComputerKind, 'none'>, ComputerProvider>>;

export interface HarnessDeps {
  repos: Repos;
  bus: EventBus;
  broker: Broker;
  engines: EngineRegistry;
  computers: ComputerProviders;
  mcp: BrotMcp | undefined;
  mode: ServerMode;
  computerImage: string;
  /** This server's loopback URL: the MCP endpoint for runs that have no computer. */
  loopbackUrl(): string;
  chains: ChainLedger;
  /** Relays model requests of `RELAYED_ENGINES` runs, so the provider key never reaches the engine. */
  llm: LlmRelay;
}

/**
 * Engines that call their model through the Brot relay (`ctx.llm`) and not over their own network route. Their
 * bots need a provider and a vault secret, and the computer needs no model hosts.
 */
const RELAYED_ENGINES: ReadonlySet<string> = new Set(['dsh']);

/**
 * A run for one bot in one thread. `inputMessage` is the stored message the run answers. When it is absent,
 * the harness stores `input` as a new message, authored by `fromBotId` (when a bot caused the run).
 */
export interface StartBotRunInput extends BotRunRequest {
  inputMessage?: Message;
  /**
   * Default `true`: when the bot already has a run in flight in this thread, the new run waits for its turn.
   * `false`: the call throws instead. A caller that blocks on the run must pass `false`, because a run that waits
   * for a bot whose turn is held by that same caller would never start.
   */
  queue?: boolean;
}

export interface StartedBotRun {
  runId: string;
  /** Settles once the run ends, with its final text. Never rejects. */
  settled: Promise<BotRunOutcome>;
}

export interface Harness {
  /** Starts a run for the thread's own bot on a new user message. */
  startRun(threadId: string, input: string): Promise<{ runId: string }>;
  /**
   * Starts a run for any bot in a thread. Returns once the run is recorded, before it finishes. The run is recorded
   * as `running` even while it waits for the bot's previous run in the thread to end.
   */
  startBotRun(input: StartBotRunInput): Promise<StartedBotRun>;
  cancelRun(runId: string): Promise<Run | undefined>;
  cancelBotRuns(botId: string): Promise<void>;
  /** Marks runs left open by a previous process as failed, and fails tasks left in progress. Call once at boot. */
  recoverInterruptedRuns(): Promise<number>;
  /** Forgets the engine session of every thread and room of a bot. Call when the bot's engine changes. */
  resetEngineSessions(botId: string): Promise<void>;
  /** Aborts in-flight and queued runs without writing state, so the next boot recovers them. */
  shutdown(): void;
}

interface ActiveRun {
  runId: string;
  threadId: string;
  botId: string;
  /** The (thread, bot) lane this run waits in. Runs of one lane take their engine turns one at a time. */
  laneKey: string;
  messageId: string;
  controller: AbortController;
  text: string;
  usage: { tokensIn: number; tokensOut: number; costUsd: number };
  /** Set when the run's model goes through the relay. The relay counts its usage, so engine usage events are ignored. */
  relayed: boolean;
  /** Rooms, and runs of a bot that is not the thread's own, keep their session in `thread_sessions`. */
  ownSession: boolean;
  /** Set by the first terminal write, so completion, failure and cancellation cannot all write. */
  settled: boolean;
  terminal?: TerminalStatus;
  error?: string;
  /** Takes the run's engine turn. Called once, when the run reaches the head of its lane. */
  start(): void;
  finish(outcome: BotRunOutcome): void;
}

type TerminalStatus = 'completed' | 'failed' | 'cancelled';

export function createHarness(deps: HarnessDeps): Harness {
  const { repos, bus, broker, engines, computers, mcp, llm, mode, computerImage, loopbackUrl, chains } = deps;
  /** Every run that has not ended, queued ones included, by run id. */
  const active = new Map<string, ActiveRun>();
  /**
   * The runs of each (thread, bot), oldest first. The head holds the engine until its engine turn has ended, and
   * every other run waits behind it. A lane exists only while it has runs.
   */
  const lanes = new Map<string, ActiveRun[]>();
  /** The trigger message of each bot's latest run in each thread. Room context is built from it. */
  const lastTrigger = new Map<string, string>();

  llm.onUsage((runId, usage) => {
    const state = active.get(runId);
    if (state === undefined || state.settled) return;
    recordUsage(state, usage).catch((error: unknown) => console.error(`usage of run ${runId} could not be recorded`, error));
  });

  async function storeMessage(input: {
    threadId: string;
    role: Message['role'];
    content: string;
    authorBotId?: string;
    viaBotId?: string;
  }): Promise<Message> {
    const message = await repos.messages.create(input);
    await bus.publish({ type: 'message.completed', threadId: input.threadId, message });
    return message;
  }

  async function startRun(threadId: string, input: string): Promise<{ runId: string }> {
    const thread = await repos.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} does not exist`);
    const bot = await repos.bots.get(thread.botId);
    if (!bot) throw new Error(`Bot ${thread.botId} does not exist`);
    const message = await storeMessage({ threadId, role: 'user', content: input });
    const started = await startBotRun({ botId: bot.id, threadId, input, inputMessage: message });
    return { runId: started.runId };
  }

  async function startBotRun(req: StartBotRunInput): Promise<StartedBotRun> {
    const thread = await repos.threads.get(req.threadId);
    if (!thread) throw new Error(`Thread ${req.threadId} does not exist`);
    const bot = await repos.bots.get(req.botId);
    if (!bot) throw new Error(`Bot ${req.botId} does not exist`);
    if (req.chain) chains.assertCanStart(req.chain, bot);
    const key = laneKeyOf(thread.id, bot.id);
    if (req.queue === false && lanes.has(key)) throw new Error(busyMessage(bot.name));

    const trigger =
      req.inputMessage ??
      (await storeMessage({
        threadId: thread.id,
        role: 'user',
        content: req.input,
        ...(req.fromBotId === undefined ? {} : { authorBotId: req.fromBotId, viaBotId: bot.id }),
      }));
    const ownSession = thread.kind === 'room' || bot.id !== thread.botId;
    const previousTriggerId = lastTrigger.get(key);
    lastTrigger.set(key, trigger.id);

    const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: bot.engine, model: bot.model });
    if (req.chain) chains.enter(run.id, req.chain, bot);

    let finish: (outcome: BotRunOutcome) => void = () => undefined;
    const settled = new Promise<BotRunOutcome>((resolve) => {
      finish = resolve;
    });
    const state: ActiveRun = {
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      laneKey: key,
      messageId: crypto.randomUUID(),
      controller: new AbortController(),
      text: '',
      usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
      relayed: false,
      ownSession,
      settled: false,
      start() {
        void execute(state, trigger, previousTriggerId).catch((error: unknown) => {
          console.error(`run ${run.id} could not be finalized`, error);
        });
      },
      finish,
    };
    await bus.publish({
      type: 'run.started',
      threadId: thread.id,
      runId: run.id,
      botId: bot.id,
      engine: bot.engine,
      model: bot.model,
    });

    if (req.queue === false && lanes.has(key)) {
      // Another run took the bot's turn while this one was being recorded.
      await settle(state, 'failed', busyMessage(bot.name));
      state.finish(outcomeOf(state));
      throw new Error(busyMessage(bot.name));
    }
    active.set(run.id, state);
    const lane = lanes.get(key);
    if (lane) {
      lane.push(state);
    } else {
      lanes.set(key, [state]);
      state.start();
    }
    return { runId: run.id, settled };
  }

  /**
   * Runs one run's engine turn. The turn's context is read here, not when the run was queued, so a queued run sees
   * what the run before it wrote. Its lane is released only after the engine has returned, so the engine never
   * sees two turns of one bot in one thread.
   */
  async function execute(state: ActiveRun, trigger: Message, previousTriggerId: string | undefined): Promise<void> {
    try {
      if (state.controller.signal.aborted) return;
      const thread = await repos.threads.get(state.threadId);
      const bot = await repos.bots.get(state.botId);
      if (!thread || !bot) throw new Error(`Run ${state.runId} lost its thread or bot before it started`);
      const engineSessionId = state.ownSession
        ? await repos.threadSessions.get(thread.id, bot.id)
        : thread.engineSessionId;
      const turn = await buildTurn(repos, {
        thread,
        bot,
        trigger,
        resumed: engineSessionId !== undefined,
        ...(previousTriggerId === undefined ? {} : { previousTriggerId }),
      });
      const driver = await readyDriver(bot);
      const relay = RELAYED_ENGINES.has(bot.engine) ? await relayRoute(state, bot) : undefined;
      const place = await placeRun(state, bot, relay === undefined ? modelHostsFor(bot.engine) : []);
      if (state.controller.signal.aborted) return;
      const llmRoute: LlmRoute | undefined =
        relay === undefined
          ? undefined
          : {
              provider: relay.provider.id,
              model: relay.model,
              api: relay.provider.api,
              baseUrl: `${place.brotBaseUrl}/llm/runs/${encodeURIComponent(state.runId)}/v1`,
              token: relay.token,
            };
      const mcpServers = mcp
        ? [mcp.specForRun({ botId: bot.id, threadId: state.threadId, runId: state.runId }, place.brotBaseUrl)]
        : undefined;
      const ctx: RunContext = {
        runId: state.runId,
        threadId: state.threadId,
        bot,
        history: turn.history,
        input: turn.input,
        memories: await repos.memories.listByBot(bot.id),
        skills: await repos.skills.listForBot(bot.id),
        signal: state.controller.signal,
        requestTool: (req) => requestTool(state, req),
        ...(engineSessionId === undefined ? {} : { engineSessionId }),
        ...(place.computer === undefined ? {} : { computer: place.computer }),
        ...(mcpServers === undefined ? {} : { mcpServers }),
        ...(llmRoute === undefined ? {} : { llm: llmRoute }),
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
      release(state);
      state.finish(outcomeOf(state));
    }
  }

  /** Hands the lane to the run queued behind `state`, if any. Only the head of a lane ever calls this. */
  function release(state: ActiveRun): void {
    const lane = lanes.get(state.laneKey);
    if (lane?.[0] !== state) return;
    lane.shift();
    const next = lane[0];
    if (next === undefined) lanes.delete(state.laneKey);
    else next.start();
  }

  /** Removes a run that waits for its turn. The run holding the lane is never removed here. */
  function leaveLane(state: ActiveRun): boolean {
    const lane = lanes.get(state.laneKey);
    const index = lane?.indexOf(state) ?? -1;
    if (!lane || index <= 0) return false;
    lane.splice(index, 1);
    active.delete(state.runId);
    return true;
  }

  /**
   * Resolves a relayed bot's model to its provider and mints the run's token. Runs before the computer starts, so a
   * missing provider or key fails the run without starting anything. The token is revoked when the run settles.
   */
  async function relayRoute(state: ActiveRun, bot: Bot): Promise<ResolvedRoute & { token: string }> {
    if (bot.model === undefined) {
      throw new Error(`Bot "${bot.name}" has no model. Set it to <provider>/<model>, for example opencode-go/deepseek-v4.1-flash.`);
    }
    const resolved = { ...(await llm.resolve(bot.model)), session: conversationId(state.threadId, bot.id) };
    state.relayed = true;
    return { ...resolved, token: llm.issue(state.runId, resolved) };
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

  /**
   * Where the run's tools execute. A `none` bot gets no computer and reaches Brot on loopback. A
   * `sandbox` or `host` bot must get its own provider's computer; a missing or unavailable provider fails
   * the run and never falls back to another kind. `brotBaseUrl` is the Brot server as seen from the engine.
   */
  async function placeRun(
    state: ActiveRun,
    bot: Bot,
    extraHosts: string[],
  ): Promise<{ computer?: ComputerHandle; brotBaseUrl: string }> {
    if (bot.computer === 'none') return { brotBaseUrl: loopbackUrl() };
    return startComputer(state, bot, bot.computer, extraHosts);
  }

  async function startComputer(
    state: ActiveRun,
    bot: Bot,
    kind: Exclude<ComputerKind, 'none'>,
    extraHosts: string[],
  ): Promise<{ computer: ComputerHandle; brotBaseUrl: string }> {
    const image = kind === 'host' ? 'host' : computerImage;
    const scope = { threadId: state.threadId, runId: state.runId };
    try {
      if (kind === 'host' && mode !== 'desktop') {
        throw new Error('host computers run only on a desktop server (BROT_MODE=desktop)');
      }
      const provider = computers[kind];
      if (provider === undefined) throw new Error(`no ${kind} computer provider is configured on this server`);
      const availability = await provider.available();
      if (!availability.ok) throw new Error(availability.reason);

      if ((await repos.computers.getByBot(bot.id))?.state !== 'ready') {
        await setComputerState(bot, image, scope, { state: 'starting' });
      }
      const computer = await provider.ensure(bot, {
        extraHosts,
        onBlocked: (host) => reportBlocked(state, bot.id, host),
      });
      await setComputerState(bot, image, scope, { state: 'ready' });
      return { computer, brotBaseUrl: provider.internalEndpoint().url };
    } catch (error) {
      const message = errorMessage(error);
      await setComputerState(bot, image, scope, { state: 'error', error: message });
      throw new Error(`The ${kind} computer for "${bot.name}" is not available: ${message}`, { cause: error });
    }
  }

  /** Persists a computer state and publishes `computer.status` when the state or its error changes. */
  async function setComputerState(
    bot: Bot,
    image: string,
    scope: { threadId: string; runId: string },
    update: { state: ComputerState; error?: string },
  ): Promise<void> {
    const previous = await repos.computers.getByBot(bot.id);
    const computer = await repos.computers.upsert(bot.id, { state: update.state, image, error: update.error });
    if (previous?.state === computer.state && previous.error === computer.error) return;
    await bus.publish({
      type: 'computer.status',
      threadId: scope.threadId,
      runId: scope.runId,
      computerId: computer.id,
      botId: bot.id,
      state: computer.state,
      ...(computer.error === undefined ? {} : { reason: computer.error }),
    });
  }

  function reportBlocked(state: ActiveRun, botId: string, host: string): void {
    bus
      .publish({ type: 'network.blocked', threadId: state.threadId, runId: state.runId, botId, host })
      .catch((error: unknown) => console.error('network.blocked could not be recorded', error));
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
        // A relayed run is counted from the relay, which sees every provider response.
        if (!state.relayed) await recordUsage(state, event);
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
      case 'engine.session':
        if (state.ownSession) {
          await repos.threadSessions.set(threadId, state.botId, event.sessionId);
        } else {
          await repos.threads.setEngineSessionId(threadId, event.sessionId);
        }
        return;
    }
  }

  /** Adds one usage report to the run's totals, then publishes the totals. `cost.updated` carries run totals. */
  async function recordUsage(state: ActiveRun, usage: RunUsage): Promise<void> {
    const { threadId, runId } = state;
    state.usage.tokensIn += usage.tokensIn;
    state.usage.tokensOut += usage.tokensOut;
    state.usage.costUsd += usage.costUsd;
    chains.recordUsage(runId, usage.costUsd);
    await repos.runs.update(runId, { ...state.usage });
    await bus.publish({ type: 'cost.updated', threadId, runId, ...state.usage });
  }

  async function complete(state: ActiveRun): Promise<void> {
    if (state.settled) return;
    const message = await repos.messages.create({
      id: state.messageId,
      threadId: state.threadId,
      role: 'assistant',
      content: state.text,
      authorBotId: state.botId,
    });
    await bus.publish({ type: 'message.completed', threadId: state.threadId, runId: state.runId, message });
    await settle(state, 'completed');
  }

  /**
   * Writes the run's terminal status and event. Only the first call has any effect. The outcome is delivered by
   * `finish`, which the caller invokes once the run has let go of its lane.
   */
  async function settle(state: ActiveRun, status: TerminalStatus, error?: string): Promise<void> {
    if (state.settled) return;
    state.settled = true;
    state.terminal = status;
    state.error = error;
    const { threadId, runId } = state;
    mcp?.endRun(runId);
    llm.revoke(runId);
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
    leaveLane(state);
    try {
      await broker.cancelRun(runId);
      await settle(state, 'cancelled');
    } finally {
      // The outcome is delivered now even when the engine is still stopping. The next queued run still waits for
      // the engine to return, because the lane is released only then.
      state.finish(outcomeOf(state));
    }
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
    await failOrphanedTasks();
    return recovered;
  }

  /** Called at boot, when no run is live. A task still in progress has lost its work run, so it fails with the reason. */
  async function failOrphanedTasks(): Promise<void> {
    for (const task of await repos.tasks.list({ status: 'in_progress' })) {
      const failed = await repos.tasks.update(task.id, { status: 'failed', result: 'server restarted' });
      if (failed) await bus.publish({ type: 'task.updated', threadId: failed.threadId, task: failed });
    }
  }

  async function resetEngineSessions(botId: string): Promise<void> {
    await repos.threadSessions.clearBot(botId);
  }

  function shutdown(): void {
    for (const state of [...active.values()]) {
      state.controller.abort();
      if (leaveLane(state)) state.finish(outcomeOf(state));
    }
  }

  return {
    startRun,
    startBotRun,
    cancelRun,
    cancelBotRuns,
    recoverInterruptedRuns,
    resetEngineSessions,
    shutdown,
  };
}

function laneKeyOf(threadId: string, botId: string): string {
  return `${threadId}\u0000${botId}`;
}

function busyMessage(botName: string): string {
  return `"${botName}" is already working in this thread. Ask again when it is free.`;
}

function outcomeOf(state: ActiveRun): BotRunOutcome {
  return {
    runId: state.runId,
    status: state.terminal ?? 'cancelled',
    text: state.text,
    ...(state.error === undefined ? {} : { error: state.error }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A stable, opaque id for one bot's conversation in one thread. Providers see this, never the raw ids. */
function conversationId(threadId: string, botId: string): string {
  return createHash('sha256').update(`${threadId}:${botId}`).digest('base64url').slice(0, 32);
}
