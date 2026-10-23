import { createHash } from 'node:crypto';
import type { Repos } from '@brot/db';
import { modelHostsFor, type BrotRunContext, type EngineRegistry } from '@brot/engines';
import type {
  Bot,
  ComputerHandle,
  ComputerKind,
  ComputerState,
  EngineDriver,
  EngineEvent,
  LlmRoute,
  Memory,
  Message,
  Run,
  Thread,
  ToolDecision,
  ToolRequest,
} from '@brot/protocol';
import type { Broker } from './broker';
import type { EventBus } from './bus';
import { DESKTOP_IMAGE } from './computers/docker-args';
import type { ComputerProvider } from './computers/types';
import type { ServerMode } from './config';
import type { LlmRelay, ResolvedRoute, RunUsage } from './llm';
import { appendAttachmentContext, type AttachmentStorage } from './attachments';
import type { BrotMcp } from './mcp/types';
import { enabledMcpServerSpecs } from './mcp-servers/specs';
import { selectForPrompt } from './memory/recall';
import type { ChainLedger } from './rooms/chains';
import { buildTurn, roomFor } from './rooms/context';
import type { BotRunOutcome, BotRunRequest } from './team/types';
import type { Vault } from './vault';

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
  /** Resolves a user MCP server's `secret://` env values into its child process. Values never reach the model. */
  vault: Vault;
  /** Reads attachment bytes for the prompt. Only attachment ids reach it; no filesystem path does. */
  attachments: AttachmentStorage;
  /** Whether the Brot team tools are attached to runs that have the Brot MCP server. Shown to the engine in the prompt. */
  teamTools?: boolean;
}

/**
 * Engines that call their model through the Brot relay (`ctx.llm`) and not over their own network route. Their
 * bots need a provider and a vault secret, and the computer needs no model hosts.
 */
const RELAYED_ENGINES: ReadonlySet<string> = new Set(['dsh']);

/** The most engine attempts one run makes: the primary model, then at most two fallbacks. */
const MODEL_ATTEMPTS = 3;

/** Caps for the workspace facts a run carries. Bot memories have their own recall caps in memory/recall.ts. */
const WORKSPACE_MEMORY_ITEMS = 20;
const WORKSPACE_MEMORY_CHARS = 3000;

/**
 * The workspace facts a run's prompt carries, newest first within the caps (`listWorkspace` returns oldest first).
 * Together with the bot's recalled memories (12 items, 6000 characters) the prompt holds at most 32 memories and
 * 9000 characters.
 */
function workspaceMemoriesForPrompt(memories: readonly Memory[]): Memory[] {
  const selected: Memory[] = [];
  let chars = 0;
  for (const memory of [...memories].reverse()) {
    if (selected.length >= WORKSPACE_MEMORY_ITEMS) break;
    if (chars + memory.content.length > WORKSPACE_MEMORY_CHARS) continue;
    selected.push(memory);
    chars += memory.content.length;
  }
  return selected;
}

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
  /**
   * Starts a run for the thread's own bot on a new user message, linking the given uploaded attachments
   * to it. Resolves with the persisted message, attachments included.
   */
  startRun(threadId: string, input: string, attachmentIds?: readonly string[]): Promise<{ runId: string; message: Message }>;
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
  /** The model the run is currently using. It changes when a fallback takes over. */
  model?: string;
  /** The bot's name at the time the run started, for budget messages. */
  botName: string;
  /** The bot's per-run USD cap at the time the run started. Absent means no cap. */
  runBudgetUsd?: number;
  /** Set when the run budget was crossed, so the abort can never be read as a user cancel. */
  budgetViolation?: string;
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

/** A resolved model route for one attempt. `index` is the model's place in the run's candidate chain. */
interface AttemptRoute {
  model: string;
  index: number;
  route: ResolvedRoute & { token: string };
}

export function createHarness(deps: HarnessDeps): Harness {
  const {
    repos,
    bus,
    broker,
    engines,
    computers,
    mcp,
    llm,
    mode,
    computerImage,
    loopbackUrl,
    chains,
    vault,
    attachments: attachmentStorage,
  } = deps;
  const teamTools = deps.teamTools ?? false;
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

  /** Links the uploaded attachments to the stored message and returns the message as the API sees it. */
  async function linkAttachments(ids: readonly string[], messageId: string): Promise<Message> {
    await repos.attachments.linkToMessage(ids, messageId);
    const linked = await repos.messages.get(messageId);
    if (linked === undefined) throw new Error(`Message ${messageId} disappeared while its attachments were linked`);
    return linked;
  }

  async function storeMessage(input: {
    threadId: string;
    role: Message['role'];
    content: string;
    authorBotId?: string;
    viaBotId?: string;
    attachmentIds?: readonly string[];
  }): Promise<Message> {
    const created = await repos.messages.create(input);
    const message =
      input.attachmentIds === undefined || input.attachmentIds.length === 0
        ? created
        : await linkAttachments(input.attachmentIds, created.id);
    await bus.publish({ type: 'message.completed', threadId: input.threadId, message });
    return message;
  }

  async function startRun(
    threadId: string,
    input: string,
    attachmentIds?: readonly string[],
  ): Promise<{ runId: string; message: Message }> {
    const thread = await repos.threads.get(threadId);
    if (!thread) throw new Error(`Thread ${threadId} does not exist`);
    const bot = await repos.bots.get(thread.botId);
    if (!bot) throw new Error(`Bot ${thread.botId} does not exist`);
    const message = await storeMessage({
      threadId,
      role: 'user',
      content: input,
      ...(attachmentIds === undefined || attachmentIds.length === 0 ? {} : { attachmentIds }),
    });
    const started = await startBotRun({ botId: bot.id, threadId, input, inputMessage: message });
    return { runId: started.runId, message };
  }

  async function startBotRun(req: StartBotRunInput): Promise<StartedBotRun> {
    const thread = await repos.threads.get(req.threadId);
    if (!thread) throw new Error(`Thread ${req.threadId} does not exist`);
    const bot = await repos.bots.get(req.botId);
    if (!bot) throw new Error(`Bot ${req.botId} does not exist`);
    const inRoom = thread.kind === 'room';
    if (req.chain) chains.assertCanStart(req.chain, bot, inRoom);
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
    const ownSession = inRoom || bot.id !== thread.botId;
    const previousTriggerId = lastTrigger.get(key);
    lastTrigger.set(key, trigger.id);

    const model = modelFor(thread, bot);
    const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: bot.engine, model });
    if (req.chain) chains.enter(run.id, req.chain, bot, inRoom);

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
      ...(model === undefined ? {} : { model }),
      botName: bot.name,
      ...(bot.runBudgetUsd === undefined ? {} : { runBudgetUsd: bot.runBudgetUsd }),
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
      model,
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

  /** The model a run uses: a DM thread may override its bot's model; rooms never carry one. */
  function modelFor(thread: Thread, bot: Bot): string | undefined {
    return thread.model ?? bot.model;
  }

  /** The bot's team and its shared brief, read once for this run. Absent for an ungrouped bot. */
  async function teamFor(bot: Bot): Promise<BrotRunContext['team']> {
    if (bot.teamId === undefined) return undefined;
    const team = await repos.teams.get(bot.teamId);
    return team === undefined ? undefined : { name: team.name, instructions: team.instructions };
  }

  /**
   * Runs one run's engine turn. The turn's context is read here, not when the run was queued, so a queued run sees
   * what the run before it wrote. Its lane is released only after the engine has returned, so the engine never
   * sees two turns of one bot in one thread.
   *
   * A relayed run may try a short chain of models: first the route that resolves (fallbacks included), then, when
   * the engine fails before producing any assistant text and the run was not cancelled, the next model. Every
   * attempt updates the same run record and re-publishes `run.started` with its model. A tool or approval denial
   * arrives as a tool result, not an engine error, so it never triggers a retry.
   */
  async function execute(state: ActiveRun, trigger: Message, previousTriggerId: string | undefined): Promise<void> {
    try {
      if (state.controller.signal.aborted) return;
      const thread = await repos.threads.get(state.threadId);
      const bot = await repos.bots.get(state.botId);
      if (!thread || !bot) throw new Error(`Run ${state.runId} lost its thread or bot before it started`);
      // The daily cap is checked before the engine or a computer starts: one cheap sum of the bot's runs today.
      if (bot.dailyBudgetUsd !== undefined) {
        const spent = await repos.runs.costSince(bot.id, utcDayStart());
        if (spent >= bot.dailyBudgetUsd) {
          throw new Error(
            `Daily budget for "${bot.name}" is exhausted: spent $${spent} of $${bot.dailyBudgetUsd} today.`,
          );
        }
      }
      const driver = await readyDriver(bot);
      const relayed = RELAYED_ENGINES.has(bot.engine);
      const models = relayed ? modelCandidatesFor(thread, bot) : [];
      if (relayed && models.length === 0) {
        throw new Error(`Bot "${bot.name}" has no model. Set it to <provider>/<model>, for example opencode-go/deepseek-v4.1-flash.`);
      }
      const storedSessionId = state.ownSession
        ? await repos.threadSessions.get(thread.id, bot.id)
        : thread.engineSessionId;
      let route = relayed ? await resolveRouteFrom(state, bot, models, 0) : undefined;
      if (route !== undefined) await adoptModel(state, bot, route.model);
      if (state.controller.signal.aborted) return;
      const place = await placeRun(state, bot, route === undefined ? modelHostsFor(bot.engine) : []);
      if (state.controller.signal.aborted) return;
      // The run's engine gets the Brot MCP server and every enabled user server. Secret env values are resolved
      // here, for the child process only: they are part of the spec, never of the prompt or an event.
      const userMcpServers = await enabledMcpServerSpecs(repos, vault, bot);
      const brotMcpServers = mcp
        ? [mcp.specForRun({ botId: bot.id, threadId: state.threadId, runId: state.runId }, place.brotBaseUrl)]
        : [];
      const mcpServers = [...brotMcpServers, ...userMcpServers];
      const [room, team, skills] = await Promise.all([
        roomFor(repos, thread),
        teamFor(bot),
        repos.skills.listForBot(bot.id),
      ]);
      let attempts = 0;
      for (;;) {
        if (state.controller.signal.aborted) return;
        attempts += 1;
        // A retry starts a fresh engine session: the prompt is sent in full again on this model (and the DSH launch
        // key includes the model, so the engine gets a process for it).
        const retry = attempts > 1;
        const engineSessionId = retry ? undefined : storedSessionId;
        const turn = await buildTurn(repos, {
          thread,
          bot,
          trigger,
          resumed: engineSessionId !== undefined,
          ...(previousTriggerId === undefined ? {} : { previousTriggerId }),
        });
        const input = await appendAttachmentContext(attachmentStorage, turn.input, trigger.attachments);
        const [workspaceMemoryRows, ownMemoryRows] = await Promise.all([
          repos.memories.listWorkspace(),
          repos.memories.listByBot(bot.id),
        ]);
        const memories = [
          ...workspaceMemoriesForPrompt(workspaceMemoryRows),
          ...selectForPrompt(ownMemoryRows, turn.input),
        ];
        const llmRoute: LlmRoute | undefined =
          route === undefined
            ? undefined
            : {
                provider: route.route.provider.id,
                model: route.route.model,
                api: route.route.provider.api,
                baseUrl: `${place.brotBaseUrl}/llm/runs/${encodeURIComponent(state.runId)}/v1`,
                token: route.route.token,
              };
        const ctx: BrotRunContext = {
          runId: state.runId,
          threadId: state.threadId,
          bot,
          history: turn.history,
          input,
          memories,
          skills,
          signal: state.controller.signal,
          requestTool: (req) => requestTool(state, req),
          ...(engineSessionId === undefined ? {} : { engineSessionId }),
          ...(place.computer === undefined ? {} : { computer: place.computer }),
          ...(mcpServers.length === 0 ? {} : { mcpServers }),
          ...(llmRoute === undefined ? {} : { llm: llmRoute }),
          ...(room === undefined ? {} : { room }),
          ...(team === undefined ? {} : { team }),
          ...(teamTools && mcp !== undefined ? { teamTools: true } : {}),
        };
        try {
          for await (const event of driver.run(ctx)) {
            if (state.controller.signal.aborted) break;
            await handleEvent(state, bot, event);
          }
        } catch (error) {
          if (state.controller.signal.aborted) return;
          const next = await nextRouteAfterFailure(state, bot, models, route, attempts);
          if (next === undefined) throw error;
          route = next;
          continue;
        }
        if (state.controller.signal.aborted) return;
        await complete(state);
        return;
      }
    } catch (error) {
      if (state.controller.signal.aborted) return;
      await settle(state, 'failed', errorMessage(error));
    } finally {
      active.delete(state.runId);
      release(state);
      state.finish(outcomeOf(state));
    }
  }

  /** The models a relayed run may try, in order: the thread's model (or the bot's) and then the bot's fallbacks. */
  function modelCandidatesFor(thread: Thread, bot: Bot): string[] {
    const models = [modelFor(thread, bot), ...(bot.fallbackModels ?? [])].filter(
      (model): model is string => model !== undefined,
    );
    return [...new Set(models)];
  }

  /**
   * Updates the run's model and re-publishes `run.started` with it. The same runId may receive several
   * `run.started` events when a fallback takes over; a fold must update the run's model, not start another run.
   */
  async function adoptModel(state: ActiveRun, bot: Bot, model: string): Promise<void> {
    if (state.model === model) return;
    state.model = model;
    await repos.runs.update(state.runId, { model });
    await bus.publish({
      type: 'run.started',
      threadId: state.threadId,
      runId: state.runId,
      botId: state.botId,
      engine: bot.engine,
      model,
    });
  }

  /**
   * Resolves the first usable model at or after `from`, trying the chain's later refs when one fails to resolve
   * (unknown provider, missing key, unusable route). When none resolves, fails with the first error and the refs
   * that were tried. The error only names models and reasons, never a secret value.
   */
  async function resolveRouteFrom(
    state: ActiveRun,
    bot: Bot,
    models: readonly string[],
    from: number,
  ): Promise<AttemptRoute> {
    const failures: string[] = [];
    for (let index = from; index < models.length; index += 1) {
      const model = models[index];
      if (model === undefined) continue;
      try {
        const resolved = { ...(await llm.resolve(model)), session: conversationId(state.threadId, bot.id) };
        state.relayed = true;
        return { model, index, route: { ...resolved, token: llm.issue(state.runId, resolved) } };
      } catch (error) {
        failures.push(`${model}: ${errorMessage(error)}`);
      }
    }
    const tried = models.slice(from).join(', ');
    throw new Error(`${failures[0] ?? 'no model route could be resolved'} Tried models: ${tried}.`);
  }

  /**
   * The next route to try after an engine failure, or undefined when the run must fail. Only a relayed run that
   * produced no assistant text, was not cancelled, and still has an untried model within the attempt cap retries.
   */
  async function nextRouteAfterFailure(
    state: ActiveRun,
    bot: Bot,
    models: readonly string[],
    current: AttemptRoute | undefined,
    attempts: number,
  ): Promise<AttemptRoute | undefined> {
    if (state.text !== '' || current === undefined || attempts >= MODEL_ATTEMPTS) return undefined;
    const from = current.index + 1;
    if (from >= models.length) return undefined;
    const next = await resolveRouteFrom(state, bot, models, from);
    await adoptModel(state, bot, next.model);
    return next;
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
    const image = kind === 'host' ? 'host' : bot.desktop === true ? DESKTOP_IMAGE : computerImage;
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
    enforceRunBudget(state);
  }

  /**
   * Stops a run whose accumulated cost crossed its per-run cap. The violation flag is set before aborting, so the
   * abort is never read as a user cancel; the run settles as failed and no fallback model is tried afterwards.
   */
  function enforceRunBudget(state: ActiveRun): void {
    const budget = state.runBudgetUsd;
    if (budget === undefined || state.settled || state.budgetViolation !== undefined) return;
    if (state.usage.costUsd <= budget) return;
    const message = `Run budget for "${state.botName}" exceeded: spent $${state.usage.costUsd} of $${budget}.`;
    state.budgetViolation = message;
    state.controller.abort();
    void settle(state, 'failed', message).catch((error: unknown) => {
      console.error(`run ${state.runId} could not be settled after its budget was exceeded`, error);
    });
  }

  async function complete(state: ActiveRun): Promise<void> {
    // A budget abort can settle the run while the engine is finishing; never mark that run completed.
    if (state.settled || state.budgetViolation !== undefined) return;
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

/** Midnight UTC of `now`'s day, as ISO. The daily budget window is [this, now). */
function utcDayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** A stable, opaque id for one bot's conversation in one thread. Providers see this, never the raw ids. */
function conversationId(threadId: string, botId: string): string {
  return createHash('sha256').update(`${threadId}:${botId}`).digest('base64url').slice(0, 32);
}

/** The narrow dependencies of the boot-time approval expiry, so a test can fake the repos and the bus. */
export interface ApprovalExpiryDeps {
  approvals: Pick<Repos['approvals'], 'listPending' | 'expire'>;
  runs: Pick<Repos['runs'], 'get'>;
  bus: Pick<EventBus, 'publish'>;
}

/** The reply an approval gets when its run was interrupted, unless it already carries one. */
export const ORPHANED_APPROVAL_REPLY = 'The run was interrupted by a server restart.';

/**
 * Expires approvals a restart left pending. An approval whose run is gone, or whose run is no longer `running` or
 * `waiting_approval`, can never be decided: after `recoverInterruptedRuns` those runs are failed. Each such approval
 * becomes `expired` (resolvedAt set, no decision), gets an explanatory reply when it has none, and publishes
 * `approval.resolved`. Best effort: never throws, and returns how many approvals were expired.
 */
export async function expireOrphanedApprovals(deps: ApprovalExpiryDeps): Promise<number> {
  try {
    let expired = 0;
    for (const approval of await deps.approvals.listPending()) {
      const run = await deps.runs.get(approval.runId);
      if (run !== undefined && (run.status === 'running' || run.status === 'waiting_approval')) continue;
      const updated = await deps.approvals.expire(approval.id, ORPHANED_APPROVAL_REPLY);
      if (updated === undefined) continue;
      await deps.bus.publish({
        type: 'approval.resolved',
        threadId: updated.threadId,
        runId: updated.runId,
        approval: updated,
      });
      expired += 1;
    }
    if (expired > 0) console.warn(`expired ${expired} approval(s) left pending by an interrupted run`);
    return expired;
  } catch (error) {
    console.error('could not expire orphaned approvals', error);
    return 0;
  }
}
