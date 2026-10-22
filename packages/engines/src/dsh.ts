import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type McpServer as AcpMcpServer,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type {
  ComputerHandle,
  ComputerProcess,
  EngineAvailability,
  EngineDriver,
  EngineEvent,
  LlmRoute,
  McpServerSpec,
  ModelInfo,
  RunContext,
  ToolDecision,
  ToolRequest,
} from '@brot/protocol';
import { untilAborted } from './abort';
import {
  allowOptionId,
  approvalKindFor,
  createToolState,
  currentModelValue,
  finishTool,
  MODEL_CONFIG_ID,
  modelEntries,
  modelValueFor,
  rejectOptionId,
  startTool,
  type ModelEntry,
  type ToolInfo,
  type ToolState,
  updateEvents,
  usageEvents,
} from './dsh-protocol';
import { llmLaunchKey, llmOverlay, LLM_TOKEN_ENV, routeModelId } from './dsh-llm';
import { buildPrompt, sessionInput, type BrotRunContext } from './prompt';

const LABEL = 'DeepSeek Harness';
const ACP_PROFILE = 'acp';
/** The launcher a computer image installs globally. */
const COMPUTER_LAUNCHER = 'dsh';
const DEFAULT_MODEL = 'default';
const DEFAULT_CANCEL_GRACE_MS = 5_000;
const FORCE_KILL_MS = 1_000;
const PROBE_TIMEOUT_MS = 10_000;
const STDERR_KEEP_CHARS = 2_000;
const STDERR_SHOWN_CHARS = 500;
const PATCH_FILE = 'no-tools.patch.yml';

/** Hosts the DeepSeek model route calls. A contained computer must reach them to run DSH at all. */
/** Where `images/computer` mounts the bot's persistent workspace. */
const COMPUTER_WORKSPACE = '/workspace';

export const DSH_MODEL_HOSTS: readonly string[] = ['api.deepseek.com'];

/**
 * Tool rows of the ACP profile in the pinned `@deepseek-ai/dsh` base bundle that run commands,
 * touch files, reach the network or start subagents. Brot's MCP tools are the only tools left.
 */
export const NO_TOOL_ROWS = [
  'tool-working-directory',
  'tool-bash',
  'tool-pwsh',
  'tool-jobs',
  'tool-fs',
  'tool-fs-search',
  'tool-skill',
  'tool-workflow',
  'tool-subagent',
  'tool-subagent-fork',
  'tool-subagent-control',
  'tool-subagent-list-agents',
  'tool-web',
] as const;

/** `--patch` overlay for `computer: 'none'`. Verified against the pinned launcher with `dsh --dump-config`. */
export const NO_TOOLS_PATCH = NO_TOOL_ROWS.map((id) => `- id: ${id}\n  disabled: true\n`).join('');

/** Telemetry is off in computers: its export would be blocked by egress and only adds noise. */
const DEFAULT_COMPUTER_ENV: Record<string, string> = { DSH_TELEMETRY_DISABLED: '1' };

/** Program and leading arguments that start the DSH launcher. The ACP profile flags are appended. */
export interface DshCommand {
  file: string;
  args?: string[];
}

export interface DshEngineOptions {
  /** Default: the pinned `@deepseek-ai/dsh` launcher, run with the current Node binary. */
  command?: DshCommand;
  /** Absolute working directory for DSH sessions. Default: `process.cwd()`. */
  cwd?: string;
  /** Sets `DSH_HOME` for the server processes. Default: DSH's own home, where providers are configured. */
  dshHome?: string;
  /**
   * Environment for DSH inside a computer. Host variables are never passed in, so provider keys must be
   * provisioned in the image or listed here. Default: `DSH_TELEMETRY_DISABLED=1` only.
   */
  computerEnv?: Record<string, string>;
  /** How long a cancelled prompt may take to settle before its server process tree is killed. Default: 5000. */
  cancelGraceMs?: number;
}

export interface DshEngine extends EngineDriver {
  /**
   * Stops every DSH server process of every bot in every thread. Runs in flight fail; the next run of a
   * bot in a thread resumes that bot's session.
   */
  close(): Promise<void>;
}

interface ProcessExit {
  code: number | null;
  signal: string | null;
  spawnError?: Error;
}

/** A DSH process behind the stdio the ACP connection needs: a local child or one started in a computer. */
interface Launched {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exit: Promise<ProcessExit>;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

/** Local runs are `computer: 'none'`: no tools beyond Brot MCP. Computer runs get the computer's tools. */
type Placement = { kind: 'local' } | { kind: 'computer'; computer: ComputerHandle };

const LOCAL: Placement = { kind: 'local' };

interface ServerProcess {
  /** Placement and relay route the process was started with. A run with other ones gets a new process. */
  key: string;
  launched: Launched;
  connection: ClientConnection;
  resumable: boolean;
  exited: boolean;
}

interface ActiveRun {
  ctx: RunContext;
  server: ServerProcess;
  sessionId: string;
  tools: ToolState;
  mailbox: Mailbox;
  promptSent: boolean;
  settled: boolean;
  cancelling: boolean;
  killTimer: NodeJS.Timeout | undefined;
  onAbort: () => void;
}

/**
 * One bot's DSH state in one Brot thread. A room runs several bots in one thread, each with its own
 * process and session.
 */
interface BotThreadState {
  server: ServerProcess | undefined;
  sessionId: string | undefined;
  sessionServer: ServerProcess | undefined;
  /** The MCP servers the open session was created or resumed with. Brot MCP tokens are per run. */
  mcpKey: string | undefined;
  primed: boolean;
  busy: boolean;
  model: string | undefined;
  defaultModel: string | undefined;
  catalog: ModelEntry[];
  active: ActiveRun | undefined;
}

type Item =
  | { kind: 'event'; event: EngineEvent }
  | { kind: 'done'; response: PromptResponse }
  | { kind: 'failed'; error: Error };

class Mailbox {
  private readonly items: Item[] = [];
  private readonly waiters: Array<(item: Item) => void> = [];

  push(item: Item): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.items.push(item);
    else waiter(item);
  }

  next(): Promise<Item> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((wake) => this.waiters.push(wake));
  }
}

/** Launches the pinned DSH launcher. The dependency is exact, so the ACP surface matches this engine. */
export function pinnedDshCommand(): DshCommand | undefined {
  try {
    const launcher = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/lib/bin.js');
    return { file: process.execPath, args: [launcher] };
  } catch {
    return undefined;
  }
}

/**
 * Drives DeepSeek Harness through its ACP server (`dsh --profile acp`). Each bot in each Brot thread
 * gets its own server process and one DSH session, both kept in memory while the process is alive.
 * A run with a computer executes DSH inside it; a run without one executes DSH locally with every
 * tool row disabled. A run with a `llm` route sends its model requests to Brot's relay, and its process
 * restarts when the route or its token changes. When a process dies or is stopped, the next run of that
 * bot in that thread starts a new one and resumes the bot's session by its engine session id.
 */
export function createDshEngine(opts: DshEngineOptions = {}): DshEngine {
  const command = opts.command ?? pinnedDshCommand();
  const cwd = resolve(opts.cwd ?? process.cwd());
  const cancelGraceMs = opts.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  const env: NodeJS.ProcessEnv = opts.dshHome === undefined ? process.env : { ...process.env, DSH_HOME: opts.dshHome };
  const computerEnv = { ...DEFAULT_COMPUTER_ENV, ...opts.computerEnv };

  const states = new Map<string, BotThreadState>();
  let knownModels: ModelEntry[] = [];
  let patchDir: string | undefined;

  function stateFor(threadId: string, botId: string): BotThreadState {
    const key = stateKey(threadId, botId);
    let state = states.get(key);
    if (state === undefined) {
      state = {
        server: undefined,
        sessionId: undefined,
        sessionServer: undefined,
        mcpKey: undefined,
        primed: false,
        busy: false,
        model: undefined,
        defaultModel: undefined,
        catalog: [],
        active: undefined,
      };
      states.set(key, state);
    }
    return state;
  }

  function attach(state: BotThreadState) {
    return client({ name: 'brot' })
      .onRequest(methods.client.session.requestPermission, ({ params }) => answerPermission(state, params))
      .onNotification(methods.client.session.update, ({ params }) => receiveUpdate(state, params));
  }

  function receiveUpdate(state: BotThreadState, params: SessionNotification): void {
    const { update } = params;
    if (update.sessionUpdate === 'config_option_update') {
      applyConfig(state, update.configOptions);
      return;
    }
    const run = state.active;
    if (run === undefined) return;
    for (const event of updateEvents(update, run.tools)) run.mailbox.push({ kind: 'event', event });
  }

  async function answerPermission(
    state: BotThreadState,
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const run = state.active;
    if (run === undefined) return cancelledAnswer();

    const callId = params.toolCall.toolCallId;
    const info: ToolInfo = run.tools.calls.get(callId) ?? {
      tool: params.toolCall.title ?? 'tool',
      args: {},
      kind: params.toolCall.kind,
    };
    emit(run, startTool(run.tools, callId, info));

    let decision: ToolDecision | undefined;
    try {
      decision = await untilAborted(run.ctx.requestTool(toolRequest(callId, info)), run.ctx.signal);
    } catch {
      decision = { allowed: false };
    }
    if (decision === undefined) return cancelledAnswer();

    const allowId = decision.allowed ? allowOptionId(params.options) : undefined;
    if (allowId !== undefined) return selectedAnswer(allowId);

    emit(run, finishTool(run.tools, callId, info, false, denialOutput(decision)));
    const rejectId = rejectOptionId(params.options);
    return rejectId === undefined ? cancelledAnswer() : selectedAnswer(rejectId);
  }

  function applyConfig(state: BotThreadState, options: readonly SessionConfigOption[] | null | undefined): void {
    if (options === undefined || options === null) return;
    const entries = modelEntries(options);
    if (entries.length > 0) {
      state.catalog = entries;
      knownModels = entries;
    }
    const current = currentModelValue(options);
    if (current !== undefined) {
      state.model = current;
      state.defaultModel ??= current;
    }
  }

  /** Overlays are written into one private temporary directory per engine, removed on close. */
  function overlayDirectory(): string {
    patchDir ??= mkdtempSync(join(tmpdir(), 'brot-dsh-'));
    return patchDir;
  }

  /** The no-tools overlay is written once per overlay directory. */
  function noToolsPatchPath(): string {
    const path = join(overlayDirectory(), PATCH_FILE);
    if (!existsSync(path)) writeFileSync(path, NO_TOOLS_PATCH, { mode: 0o600 });
    return path;
  }

  /** A route's overlay is written for each local process: its route and token belong to that process. */
  function llmPatchPath(llm: LlmRoute): string {
    const path = join(overlayDirectory(), `llm-${randomUUID()}.patch.yml`);
    writeFileSync(path, llmOverlay(llm), { mode: 0o600 });
    return path;
  }

  async function ensureServer(
    state: BotThreadState,
    placement: Placement,
    llm: LlmRoute | undefined,
  ): Promise<ServerProcess> {
    const key = serverKey(placement, llm);
    const current = state.server;
    if (current !== undefined && isLive(current) && current.key === key) return current;
    if (current !== undefined) {
      state.server = undefined;
      await stopServer(current);
    }
    const server = await launch(state, placement, llm);
    state.server = server;
    return server;
  }

  async function startProcess(placement: Placement, llm: LlmRoute | undefined): Promise<Launched> {
    if (placement.kind === 'computer') {
      const launcher = [COMPUTER_LAUNCHER, '--profile', ACP_PROFILE];
      if (llm === undefined) {
        const proc = await placement.computer.exec(launcher, { env: computerEnv });
        return fromComputer(proc);
      }
      const overlay = await writeComputerOverlay(placement.computer, llmOverlay(llm));
      const proc = await placement.computer.exec([...launcher, '--patch', overlay], {
        env: { ...computerEnv, [LLM_TOKEN_ENV]: llm.token },
      });
      return fromComputer(proc);
    }
    if (command === undefined) throw new Error(`${LABEL} (@deepseek-ai/dsh) is not installed`);
    const args = [...(command.args ?? []), '--profile', ACP_PROFILE, '--patch', noToolsPatchPath()];
    if (llm === undefined) return spawnLocal({ file: command.file, args }, env);
    args.push('--patch', llmPatchPath(llm));
    return spawnLocal({ file: command.file, args }, { ...env, [LLM_TOKEN_ENV]: llm.token });
  }

  async function launch(
    state: BotThreadState,
    placement: Placement,
    llm: LlmRoute | undefined,
  ): Promise<ServerProcess> {
    const launched = await startProcess(placement, llm);
    const tail = keepTail(launched.stderr);
    const connection = attach(state).connect(ndJsonStream(launched.stdin, protocolLines(launched.stdout)));
    const server: ServerProcess = {
      key: serverKey(placement, llm),
      launched,
      connection,
      resumable: false,
      exited: false,
    };
    void launched.exit.then((exit) => {
      server.exited = true;
      if (state.server === server) state.server = undefined;
      const run = state.active;
      if (run?.server === server) run.mailbox.push({ kind: 'failed', error: runtimeExitError(exit, tail()) });
    });

    const startupFailure = launched.exit.then((exit): never => {
      throw startupExitError(exit);
    });
    try {
      const init = await Promise.race([
        connection.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
        startupFailure,
      ]);
      if (init.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(`${LABEL} speaks ACP protocol ${init.protocolVersion}; expected ${PROTOCOL_VERSION}`);
      }
      server.resumable = Boolean(init.agentCapabilities?.sessionCapabilities?.resume);
      return server;
    } catch (error) {
      terminate(server);
      throw error;
    }
  }

  /**
   * Returns the session id for the run. Reuses the open session when its id and MCP servers still match;
   * otherwise closes it and resumes the wanted id (the run's engine session id, else the bot's last)
   * with this run's MCP servers. Creates a session only when neither can be resumed.
   */
  async function ensureSession(
    state: BotThreadState,
    server: ServerProcess,
    ctx: RunContext,
    mcpServers: AcpMcpServer[],
  ): Promise<string> {
    const mcpKey = JSON.stringify(mcpServers);
    // Inside a computer the host path does not exist; the bot's workspace is the session root.
    const sessionCwd = ctx.computer ? COMPUTER_WORKSPACE : cwd;
    const wanted = ctx.engineSessionId ?? state.sessionId;
    const open = state.sessionId !== undefined && state.sessionServer === server ? state.sessionId : undefined;
    if (open !== undefined && open === wanted && state.mcpKey === mcpKey) return open;
    if (open !== undefined) {
      state.sessionServer = undefined;
      await server.connection.agent.request(methods.agent.session.close, { sessionId: open }).catch(() => undefined);
    }

    if (wanted !== undefined && server.resumable) {
      const resumed = await server.connection.agent.request(methods.agent.session.resume, {
        sessionId: wanted,
        cwd: sessionCwd,
        mcpServers,
      }).catch(() => undefined);
      if (resumed !== undefined) {
        state.sessionId = wanted;
        state.sessionServer = server;
        state.mcpKey = mcpKey;
        state.primed = true;
        applyConfig(state, resumed.configOptions);
        return wanted;
      }
    }

    const created = await server.connection.agent.request(methods.agent.session.new, { cwd: sessionCwd, mcpServers });
    state.sessionId = created.sessionId;
    state.sessionServer = server;
    state.mcpKey = mcpKey;
    state.primed = false;
    state.model = undefined;
    state.defaultModel = undefined;
    state.catalog = [];
    applyConfig(state, created.configOptions);
    return created.sessionId;
  }

  async function applyModel(state: BotThreadState, run: ActiveRun, model: string | undefined): Promise<void> {
    let wanted: string | undefined;
    if (model === undefined || model === DEFAULT_MODEL) {
      wanted = state.defaultModel;
    } else {
      wanted = modelValueFor(state.catalog, model);
      if (wanted === undefined) throw new Error(`${LABEL} does not offer model ${model}`);
    }
    if (wanted === undefined || wanted === state.model) return;
    const response = await run.server.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: run.sessionId,
      configId: MODEL_CONFIG_ID,
      value: wanted,
    });
    applyConfig(state, response.configOptions);
  }

  function startRun(ctx: RunContext, state: BotThreadState, server: ServerProcess, sessionId: string): ActiveRun {
    const run: ActiveRun = {
      ctx,
      server,
      sessionId,
      tools: createToolState(),
      mailbox: new Mailbox(),
      promptSent: false,
      settled: false,
      cancelling: false,
      killTimer: undefined,
      onAbort: () => cancelPrompt(run),
    };
    state.active = run;
    ctx.signal.addEventListener('abort', run.onAbort, { once: true });
    return run;
  }

  function endRun(state: BotThreadState, run: ActiveRun): void {
    run.ctx.signal.removeEventListener('abort', run.onAbort);
    if (state.active === run) state.active = undefined;
    cancelPrompt(run);
  }

  /** Sends `session/cancel`; if the prompt has not settled within the grace period, the server is killed. */
  function cancelPrompt(run: ActiveRun): void {
    if (!run.promptSent || run.settled || run.cancelling) return;
    run.cancelling = true;
    run.server.connection.agent
      .notify(methods.agent.session.cancel, { sessionId: run.sessionId })
      .catch(() => undefined);
    run.killTimer = setTimeout(() => {
      if (!run.settled) terminate(run.server);
    }, cancelGraceMs);
    run.killTimer.unref();
  }

  function settle(run: ActiveRun, item: Item): void {
    run.settled = true;
    clearTimeout(run.killTimer);
    run.mailbox.push(item);
  }

  async function* execute(ctx: BrotRunContext): AsyncGenerator<EngineEvent> {
    const state = stateFor(ctx.threadId, ctx.bot.id);
    if (state.busy) throw new Error(`${LABEL} already has a run in progress for this bot in this thread`);
    state.busy = true;
    let run: ActiveRun | undefined;
    try {
      if (ctx.signal.aborted) return;
      const placement: Placement = ctx.computer === undefined ? LOCAL : { kind: 'computer', computer: ctx.computer };
      const server = await untilAborted(ensureServer(state, placement, ctx.llm), ctx.signal);
      if (server === undefined) return;
      const mcpServers = (ctx.mcpServers ?? []).map(toAcpMcpServer);
      const sessionId = await untilAborted(ensureSession(state, server, ctx, mcpServers), ctx.signal);
      if (sessionId === undefined) return;
      if (sessionId !== ctx.engineSessionId) yield { type: 'engine.session', sessionId };

      const current = startRun(ctx, state, server, sessionId);
      run = current;
      // A routed run uses its route's model: the relay is the only provider the run may reach.
      const model = ctx.llm === undefined ? ctx.bot.model : routeModelId(ctx.llm);
      await untilAborted(applyModel(state, current, model), ctx.signal);
      if (ctx.signal.aborted) return;

      const text = state.primed ? sessionInput(ctx) : buildPrompt(ctx);
      const prompt = server.connection.agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text }],
      });
      current.promptSent = true;
      void prompt.then(
        (response) => settle(current, { kind: 'done', response }),
        (error: unknown) => settle(current, { kind: 'failed', error: runError(error) }),
      );

      for (;;) {
        const item = await current.mailbox.next();
        if (item.kind === 'event') {
          yield item.event;
          continue;
        }
        if (item.kind === 'failed') {
          if (ctx.signal.aborted) return;
          throw item.error;
        }
        state.primed = true;
        for (const event of usageEvents(item.response.usage)) yield event;
        if (item.response.stopReason === 'end_turn' || ctx.signal.aborted) return;
        throw new Error(`${LABEL} stopped the run: ${item.response.stopReason}`);
      }
    } catch (error: unknown) {
      if (ctx.signal.aborted) return;
      throw runError(error);
    } finally {
      state.busy = false;
      if (run !== undefined) {
        endRun(state, run);
        // A run that ends with its server's connection closed may return before the child is reaped.
        if (!isLive(run.server)) await stopServer(run.server);
      }
    }
  }

  return {
    id: 'dsh',
    label: LABEL,
    async detect(): Promise<EngineAvailability> {
      if (command === undefined) return { available: false, reason: `${LABEL} (@deepseek-ai/dsh) is not installed` };
      return probeVersion(command, env);
    },
    async models(): Promise<ModelInfo[]> {
      return [{ id: DEFAULT_MODEL, label: 'Default' }, ...knownModels.map(({ id, label }) => ({ id, label }))];
    },
    run: execute,
    async close(): Promise<void> {
      const running = [...states.values()].flatMap((state) => {
        const server = state.server;
        state.server = undefined;
        return server !== undefined && isLive(server) ? [server] : [];
      });
      await Promise.all(running.map(stopServer));
      if (patchDir !== undefined) {
        rmSync(patchDir, { recursive: true, force: true });
        patchDir = undefined;
      }
    },
  };
}

/** Engine state is per (Brot thread, bot): a room runs several bots in one thread. */
function stateKey(threadId: string, botId: string): string {
  return JSON.stringify([threadId, botId]);
}

function placementKey(placement: Placement): string {
  return placement.kind === 'local' ? 'local' : `computer:${placement.computer.id}`;
}

function serverKey(placement: Placement, llm: LlmRoute | undefined): string {
  return JSON.stringify([placementKey(placement), llm === undefined ? null : llmLaunchKey(llm)]);
}

/** Writes the relay overlay into the computer; DSH reads it once, when it boots. Returns its path there. */
async function writeComputerOverlay(computer: ComputerHandle, overlay: string): Promise<string> {
  const path = `/tmp/brot-dsh-llm-${randomUUID()}.patch.yml`;
  const proc = await computer.exec(['sh', '-c', 'umask 077 && cat > "$1"', 'sh', path]);
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(overlay));
  await writer.close();
  const exit = await proc.exit;
  if (exit.code !== 0) throw new Error(`could not write the relay overlay into the computer (${describeExit(exit)})`);
  return path;
}

function spawnLocal(cmd: { file: string; args: string[] }, env: NodeJS.ProcessEnv): Launched {
  const child = spawn(cmd.file, cmd.args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdin.on('error', () => undefined);
  const exit = new Promise<ProcessExit>((resolveExit) => {
    child.once('error', (spawnError) => resolveExit({ code: null, signal: null, spawnError }));
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  return {
    stdin: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>,
    exit,
    kill: (signal) => signalTree(child, signal),
  };
}

function fromComputer(proc: ComputerProcess): Launched {
  return {
    stdin: proc.stdin,
    stdout: proc.stdout,
    stderr: proc.stderr,
    exit: proc.exit.then((exit) => ({ code: exit.code, signal: exit.signal })),
    kill: (signal) => proc.kill(signal),
  };
}

/** Brot MCP servers in ACP form: HTTP entries carry `type`, stdio entries do not. */
function toAcpMcpServer(spec: McpServerSpec): AcpMcpServer {
  if ('command' in spec) {
    return { name: spec.name, command: spec.command, args: spec.args, env: pairs(spec.env) };
  }
  return { type: 'http', name: spec.name, url: spec.url, headers: pairs(spec.headers) };
}

function pairs(record: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(record).map(([name, value]) => ({ name, value }));
}

function toolRequest(callId: string, info: ToolInfo): ToolRequest {
  return {
    callId,
    tool: info.tool,
    args: info.args,
    kind: approvalKindFor(info.kind),
    summary: summaryFor(info),
  };
}

function summaryFor(info: ToolInfo): string {
  const command = info.args.command;
  return typeof command === 'string' ? `${info.tool}: ${command}` : info.tool;
}

function denialOutput(decision: ToolDecision): string {
  if (decision.allowed) return 'permission option not offered by the agent';
  return decision.reply ? `denied by user: ${decision.reply}` : 'denied by user';
}

function emit(run: ActiveRun, events: EngineEvent[]): void {
  for (const event of events) run.mailbox.push({ kind: 'event', event });
}

function selectedAnswer(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: 'selected', optionId } };
}

function cancelledAnswer(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}

/** Errors that already name DeepSeek Harness pass through; anything else is labeled as a failed run. */
function runError(error: unknown): Error {
  const message = errorText(error);
  if (message.startsWith(LABEL)) return error instanceof Error ? error : new Error(message);
  return new Error(`${LABEL} run failed: ${message}`);
}

function startupExitError(exit: ProcessExit): Error {
  if (exit.spawnError !== undefined) return new Error(`${LABEL} failed to start: ${exit.spawnError.message}`);
  return new Error(`${LABEL} server ${describeExit(exit)} during startup`);
}

function runtimeExitError(exit: ProcessExit, tail: string): Error {
  if (exit.spawnError !== undefined) return new Error(`${LABEL} failed to start: ${exit.spawnError.message}`);
  return new Error(`${LABEL} server ${describeExit(exit)}${tail ? `: ${tail}` : ''}`);
}

function describeExit(exit: ProcessExit): string {
  return exit.code !== null ? `exited with code ${exit.code}` : `was killed by ${exit.signal ?? 'a signal'}`;
}

/** Keeps the last characters a process wrote to stderr. Returns a reader for the kept tail. */
function keepTail(stream: ReadableStream<Uint8Array>): () => string {
  let tail = '';
  const decoder = new TextDecoder();
  stream
    .pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          tail = (tail + decoder.decode(chunk, { stream: true })).slice(-STDERR_KEEP_CHARS);
        },
      }),
    )
    .catch(() => undefined);
  return () => tail.trim().slice(-STDERR_SHOWN_CHARS);
}

/**
 * Forwards only stdout lines that parse as JSON objects. Stray output would otherwise make the
 * SDK answer with a JSON-RPC parse error on the server's stdin.
 */
function protocolLines(stdout: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  return stdout.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        for (let newline = pending.indexOf('\n'); newline !== -1; newline = pending.indexOf('\n')) {
          const line = pending.slice(0, newline).replace(/\r$/, '');
          pending = pending.slice(newline + 1);
          if (isProtocolLine(line)) controller.enqueue(encoder.encode(`${line}\n`));
        }
      },
      flush(controller) {
        pending += decoder.decode();
        const last = pending.replace(/\r$/, '');
        pending = '';
        if (isProtocolLine(last)) controller.enqueue(encoder.encode(`${last}\n`));
      },
    }),
  );
}

function isProtocolLine(line: string): boolean {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** Stops a process, then force-kills it if it is still alive after the grace period. */
function terminate(server: ServerProcess): void {
  if (server.exited) return;
  server.launched.kill('SIGTERM');
  setTimeout(() => {
    if (!server.exited) server.launched.kill('SIGKILL');
  }, FORCE_KILL_MS).unref();
}

function isLive(server: ServerProcess): boolean {
  return !server.exited && !server.connection.signal.aborted;
}

function stopServer(server: ServerProcess): Promise<void> {
  if (server.exited) return Promise.resolve();
  const exited = server.launched.exit.then(() => undefined);
  terminate(server);
  return exited;
}

/** Signals the whole process group, so tools the server spawned die with it. */
function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function probeVersion(cmd: DshCommand, env: NodeJS.ProcessEnv): Promise<EngineAvailability> {
  return new Promise((resolveProbe) => {
    execFile(
      cmd.file,
      [...(cmd.args ?? []), '--version'],
      { env, encoding: 'utf8', timeout: PROBE_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolveProbe({ available: false, reason: `${LABEL} did not answer --version: ${error.message}` });
          return;
        }
        const version = /\d+\.\d+\.\d+\S*/.exec(stdout)?.[0];
        resolveProbe(version === undefined ? { available: true } : { available: true, version });
      },
    );
  });
}
