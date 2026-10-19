import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type {
  EngineAvailability,
  EngineDriver,
  EngineEvent,
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
import { buildPrompt } from './prompt';

const LABEL = 'DeepSeek Harness';
const ACP_PROFILE = 'acp';
const DEFAULT_MODEL = 'default';
const DEFAULT_CANCEL_GRACE_MS = 5_000;
const FORCE_KILL_MS = 1_000;
const PROBE_TIMEOUT_MS = 10_000;
const STDERR_KEEP_CHARS = 2_000;
const STDERR_SHOWN_CHARS = 500;

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
  /** How long a cancelled prompt may take to settle before its server process tree is killed. Default: 5000. */
  cancelGraceMs?: number;
}

export interface DshEngine extends EngineDriver {
  /** Stops every DSH server process. Runs in flight fail; the next run on a thread resumes its session. */
  close(): Promise<void>;
}

interface ServerProcess {
  child: ChildProcess;
  connection: ClientConnection;
  resumable: boolean;
  exited: boolean;
  stderrTail(): string;
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

/** One Brot thread: its own DSH server process while alive, and the DSH session that process hosts. */
interface ThreadState {
  server: ServerProcess | undefined;
  sessionId: string | undefined;
  sessionServer: ServerProcess | undefined;
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
 * Drives DeepSeek Harness through its ACP server (`dsh --profile acp`). Each Brot thread gets its
 * own server process and one DSH session, both kept in memory while the process is alive. When a
 * process dies or is stopped, the next run starts a new one and resumes the thread's session.
 */
export function createDshEngine(opts: DshEngineOptions = {}): DshEngine {
  const command = opts.command ?? pinnedDshCommand();
  const cwd = resolve(opts.cwd ?? process.cwd());
  const cancelGraceMs = opts.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  const env: NodeJS.ProcessEnv = opts.dshHome === undefined ? process.env : { ...process.env, DSH_HOME: opts.dshHome };

  const threads = new Map<string, ThreadState>();
  let knownModels: ModelEntry[] = [];

  function threadFor(threadId: string): ThreadState {
    let thread = threads.get(threadId);
    if (thread === undefined) {
      thread = {
        server: undefined,
        sessionId: undefined,
        sessionServer: undefined,
        primed: false,
        busy: false,
        model: undefined,
        defaultModel: undefined,
        catalog: [],
        active: undefined,
      };
      threads.set(threadId, thread);
    }
    return thread;
  }

  function attach(thread: ThreadState) {
    return client({ name: 'brot' })
      .onRequest(methods.client.session.requestPermission, ({ params }) => answerPermission(thread, params))
      .onNotification(methods.client.session.update, ({ params }) => receiveUpdate(thread, params));
  }

  function receiveUpdate(thread: ThreadState, params: SessionNotification): void {
    const { update } = params;
    if (update.sessionUpdate === 'config_option_update') {
      applyConfig(thread, update.configOptions);
      return;
    }
    const run = thread.active;
    if (run === undefined) return;
    for (const event of updateEvents(update, run.tools)) run.mailbox.push({ kind: 'event', event });
  }

  async function answerPermission(
    thread: ThreadState,
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const run = thread.active;
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

  function applyConfig(thread: ThreadState, options: readonly SessionConfigOption[] | null | undefined): void {
    if (options === undefined || options === null) return;
    const entries = modelEntries(options);
    if (entries.length > 0) {
      thread.catalog = entries;
      knownModels = entries;
    }
    const current = currentModelValue(options);
    if (current !== undefined) {
      thread.model = current;
      thread.defaultModel ??= current;
    }
  }

  async function ensureServer(thread: ThreadState): Promise<ServerProcess> {
    const current = thread.server;
    if (current !== undefined && isLive(current)) return current;
    if (current !== undefined) {
      thread.server = undefined;
      await stopServer(current);
    }
    if (command === undefined) throw new Error(`${LABEL} (@deepseek-ai/dsh) is not installed`);
    const server = await launch(command, thread);
    thread.server = server;
    return server;
  }

  async function launch(cmd: DshCommand, thread: ThreadState): Promise<ServerProcess> {
    const child = spawn(cmd.file, [...(cmd.args ?? []), '--profile', ACP_PROFILE], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP_CHARS);
    });
    child.stdin.on('error', () => undefined);

    const connection = attach(thread).connect(
      ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, protocolLines(child.stdout)),
    );
    const server: ServerProcess = {
      child,
      connection,
      resumable: false,
      exited: false,
      stderrTail: () => stderr.trim().slice(-STDERR_SHOWN_CHARS),
    };
    child.once('exit', (code, signal) => {
      server.exited = true;
      if (thread.server === server) thread.server = undefined;
      const tail = server.stderrTail();
      const error = new Error(`${LABEL} server ${describeExit(code, signal)}${tail ? `: ${tail}` : ''}`);
      const run = thread.active;
      if (run?.server === server) run.mailbox.push({ kind: 'failed', error });
    });

    const startupFailure = new Promise<never>((_, reject) => {
      child.once('error', (error) => reject(new Error(`${LABEL} failed to start: ${error.message}`)));
      child.once('exit', (code, signal) => {
        reject(new Error(`${LABEL} server ${describeExit(code, signal)} during startup`));
      });
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
      killTree(child);
      throw error;
    }
  }

  async function ensureSession(thread: ThreadState, server: ServerProcess): Promise<string> {
    if (thread.sessionId !== undefined && thread.sessionServer === server) return thread.sessionId;
    if (thread.sessionId !== undefined && server.resumable) {
      const resumed = await server.connection.agent
        .request(methods.agent.session.resume, { sessionId: thread.sessionId, cwd, mcpServers: [] })
        .catch(() => undefined);
      if (resumed !== undefined) {
        thread.sessionServer = server;
        applyConfig(thread, resumed.configOptions);
        return thread.sessionId;
      }
    }
    const created = await server.connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [] });
    thread.sessionId = created.sessionId;
    thread.sessionServer = server;
    thread.primed = false;
    thread.model = undefined;
    thread.defaultModel = undefined;
    thread.catalog = [];
    applyConfig(thread, created.configOptions);
    return created.sessionId;
  }

  async function applyModel(thread: ThreadState, run: ActiveRun, model: string | undefined): Promise<void> {
    let wanted: string | undefined;
    if (model === undefined || model === DEFAULT_MODEL) {
      wanted = thread.defaultModel;
    } else {
      wanted = modelValueFor(thread.catalog, model);
      if (wanted === undefined) throw new Error(`${LABEL} does not offer model ${model}`);
    }
    if (wanted === undefined || wanted === thread.model) return;
    const response = await run.server.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: run.sessionId,
      configId: MODEL_CONFIG_ID,
      value: wanted,
    });
    applyConfig(thread, response.configOptions);
  }

  function startRun(ctx: RunContext, thread: ThreadState, server: ServerProcess, sessionId: string): ActiveRun {
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
    thread.active = run;
    ctx.signal.addEventListener('abort', run.onAbort, { once: true });
    return run;
  }

  function endRun(thread: ThreadState, run: ActiveRun): void {
    run.ctx.signal.removeEventListener('abort', run.onAbort);
    if (thread.active === run) thread.active = undefined;
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
      if (!run.settled) killTree(run.server.child);
    }, cancelGraceMs);
    run.killTimer.unref();
  }

  function settle(run: ActiveRun, item: Item): void {
    run.settled = true;
    clearTimeout(run.killTimer);
    run.mailbox.push(item);
  }

  async function* execute(ctx: RunContext): AsyncGenerator<EngineEvent> {
    const thread = threadFor(ctx.threadId);
    if (thread.busy) throw new Error(`${LABEL} already has a run in progress for this thread`);
    thread.busy = true;
    let run: ActiveRun | undefined;
    try {
      if (ctx.signal.aborted) return;
      const server = await untilAborted(ensureServer(thread), ctx.signal);
      if (server === undefined) return;
      const sessionId = await untilAborted(ensureSession(thread, server), ctx.signal);
      if (sessionId === undefined) return;

      const current = startRun(ctx, thread, server, sessionId);
      run = current;
      await untilAborted(applyModel(thread, current, ctx.bot.model), ctx.signal);
      if (ctx.signal.aborted) return;

      const text = thread.primed ? ctx.input : buildPrompt(ctx);
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
        thread.primed = true;
        for (const event of usageEvents(item.response.usage)) yield event;
        if (item.response.stopReason === 'end_turn' || ctx.signal.aborted) return;
        throw new Error(`${LABEL} stopped the run: ${item.response.stopReason}`);
      }
    } catch (error: unknown) {
      if (ctx.signal.aborted) return;
      throw runError(error);
    } finally {
      thread.busy = false;
      if (run !== undefined) endRun(thread, run);
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
      const running = [...threads.values()].flatMap((thread) => {
        const server = thread.server;
        thread.server = undefined;
        return server !== undefined && isLive(server) ? [server] : [];
      });
      await Promise.all(running.map(stopServer));
    },
  };
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

/**
 * Forwards only stdout lines that parse as JSON objects. Stray output would otherwise make the
 * SDK answer with a JSON-RPC parse error on the server's stdin.
 */
function protocolLines(stdout: Readable): ReadableStream<Uint8Array> {
  const filtered = new PassThrough();
  const lines = createInterface({ input: stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (isProtocolLine(line)) filtered.write(`${line}\n`);
  });
  lines.on('close', () => filtered.end());
  return Readable.toWeb(filtered) as ReadableStream<Uint8Array>;
}

function isProtocolLine(line: string): boolean {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** Signals the whole process group, so tools the server spawned die with it. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  signalTree(child, 'SIGTERM');
  setTimeout(() => signalTree(child, 'SIGKILL'), FORCE_KILL_MS).unref();
}

function isLive(server: ServerProcess): boolean {
  return !server.exited && !server.connection.signal.aborted;
}

function stopServer(server: ServerProcess): Promise<void> {
  if (server.exited) return Promise.resolve();
  return new Promise((resolveStop) => {
    server.child.once('exit', () => resolveStop());
    killTree(server.child);
  });
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return code !== null ? `exited with code ${code}` : `was killed by ${signal ?? 'a signal'}`;
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
