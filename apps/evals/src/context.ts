import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CreateMcpServerInput, CreateRoomInput, McpServer, Run, Thread } from '@brot/protocol';
import type { BotCreate, BrotApi } from './api';
import type { EngineChoice } from './args';
import {
  computerName,
  containerState,
  copyIntoContainer,
  copyOutOfContainer,
  docker,
  DockerError,
  execIn,
  WORKSPACE,
  type Exec,
} from './docker';
import { internalToolPolicies } from './approvals';
import { sleep, truncate } from './util';
import type { BotRef } from './types';

export class CaseTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseTimeoutError';
  }
}

/** Thrown inside a case once the cost guard has stopped it. The runner reads the reason and skips the checks. */
export class CaseStoppedError extends Error {
  constructor(readonly reason: string) {
    super(`stopped: ${reason}`);
    this.name = 'CaseStoppedError';
  }
}

export interface RunSettings {
  caseId: string;
  engine: EngineChoice;
  model: string;
  pollMs: number;
  /** Epoch ms after which every wait gives up. */
  deadlineAt: number;
  outDir: string;
  /** Where the case's workspace files and folders are copied for the report. */
  artifactsDir: string;
  log: (line: string) => void;
}

export interface BotSpec {
  name: string;
  job: string;
  instructions: string;
  /** Species from the avatar set, such as `onca`. */
  species: string;
  /** Avatar color from the design tokens, such as `orange`. */
  color: string;
  /** Hosts the bot may reach. Empty means no network at all. */
  egress: string[];
  teamBudgetUsd?: number;
  /** Per-run USD cap. 0 allows no spending; absent means no cap. */
  runBudgetUsd?: number;
  /** Per-UTC-day USD cap. 0 allows no spending; absent means no cap. */
  dailyBudgetUsd?: number;
  /** The default sandbox computer; `none` gives the engine only Brot's own MCP tools. */
  computer?: 'none' | 'sandbox';
  /** User MCP servers this bot may attach. Absent means every enabled server. */
  mcpServerIds?: string[];
}

export interface RoomSpec {
  title: string;
  /** Keys of the member bots. */
  members: string[];
  lead: string;
  responder?: 'lead' | 'mention';
}

const ACTIVE: ReadonlySet<Run['status']> = new Set(['running', 'waiting_approval']);
export const CRON_EVERY_NIGHT = '0 4 * * *';
const WARM_UP_MESSAGE = 'Warm-up: reply with the single word OK and nothing else.';

/**
 * What a case uses while it runs: bots, threads, messages, waits, fixtures in the computer, and routines. It keeps the
 * ids the runner needs for evidence, so cases never hold raw ids of their own.
 */
export class CaseContext {
  readonly bots = new Map<string, BotRef>();
  readonly threads = new Map<string, string>();
  /** Rooms this case created, so the runner can delete them after the evidence is collected. */
  readonly rooms: Array<{ key: string; id: string }> = [];
  /** User MCP servers this case created, so the runner can delete them after the evidence is collected. */
  readonly mcpServers: Array<{ name: string; id: string }> = [];
  readonly routines = new Map<string, { id: string; botKey: string; name: string }>();
  readonly artifactRequests: Array<{ botKey: string; path: string }> = [];
  /** Workspace folders copied out of the computer after the run, so a person can read them. */
  readonly keptFolders: Array<{ botKey: string; path: string }> = [];
  readonly probes: Record<string, unknown> = {};
  readonly notes: Record<string, unknown> = {};
  readonly secretNames: string[] = [];
  /** Set by a phase 1 case that stops here so the runner keeps its state for the restart. */
  holdRequested = false;
  /** Set by the cost guard. Every later call throws `CaseStoppedError`. */
  stopReason?: string;
  /** Text printed to the operator at the end of a held phase. */
  instructions?: string;

  private readonly roomKeys = new Set<string>();
  private readonly warm = new Set<string>();

  constructor(
    readonly api: BrotApi,
    readonly settings: RunSettings,
  ) {}

  botRef(key: string): BotRef {
    const bot = this.bots.get(key);
    if (bot === undefined) throw new Error(`case ${this.settings.caseId} has no bot "${key}" yet`);
    return bot;
  }

  botIds(): string[] {
    return [...this.bots.values()].map((bot) => bot.id);
  }

  botKeyOf(botId: string): string | undefined {
    return [...this.bots.values()].find((bot) => bot.id === botId)?.key;
  }

  threadId(key: string): string {
    const id = this.threads.get(key);
    if (id === undefined) throw new Error(`case ${this.settings.caseId} has no thread "${key}" yet`);
    return id;
  }

  /** Time left before the case gives up. */
  remainingMs(): number {
    return this.settings.deadlineAt - Date.now();
  }

  /** Ends the case's waits and posts. The first reason wins. */
  stop(reason: string): void {
    this.stopReason ??= reason;
  }

  throwIfStopped(): void {
    if (this.stopReason !== undefined) throw new CaseStoppedError(this.stopReason);
  }

  private assertTime(label: string): void {
    this.throwIfStopped();
    if (this.remainingMs() <= 0) throw new CaseTimeoutError(`timed out while waiting for ${label}`);
  }

  async createBot(key: string, spec: BotSpec): Promise<BotRef> {
    const engineIsDsh = this.settings.engine === 'dsh';
    const body: BotCreate = {
      name: spec.name,
      job: spec.job,
      instructions: spec.instructions,
      engine: engineIsDsh ? 'dsh' : 'mock',
      computer: spec.computer ?? 'sandbox',
      avatar: `${spec.species}:${spec.color}`,
      egress: spec.egress.length === 0 ? { mode: 'deny', allow: [] } : { mode: 'allowlist', allow: spec.egress },
      ...(engineIsDsh ? { model: this.settings.model } : {}),
      ...(spec.teamBudgetUsd === undefined ? {} : { teamBudgetUsd: spec.teamBudgetUsd }),
      ...(spec.runBudgetUsd === undefined ? {} : { runBudgetUsd: spec.runBudgetUsd }),
      ...(spec.dailyBudgetUsd === undefined ? {} : { dailyBudgetUsd: spec.dailyBudgetUsd }),
      ...(spec.mcpServerIds === undefined ? {} : { mcpServerIds: spec.mcpServerIds }),
    };
    const created = await this.api.createBot(body);
    for (const policy of internalToolPolicies()) await this.api.createPolicy(created.id, policy);
    const ref: BotRef = {
      key,
      id: created.id,
      name: created.name,
      engine: created.engine,
      ...(created.model === undefined ? {} : { model: created.model }),
    };
    this.bots.set(key, ref);
    this.settings.log(`${this.settings.caseId}: created bot ${spec.name} (${key}) ${ref.id}`);
    return ref;
  }

  /** The bot's DM thread, created on first use. */
  async dm(botKey: string): Promise<string> {
    const threadKey = `${botKey}:dm`;
    const existing = this.threads.get(threadKey);
    if (existing !== undefined) return existing;
    const thread = await this.api.createThread(this.botRef(botKey).id, `${this.settings.caseId} ${botKey}`);
    this.threads.set(threadKey, thread.id);
    return thread.id;
  }

  async room(key: string, spec: RoomSpec): Promise<string> {
    const input: CreateRoomInput = {
      title: spec.title,
      botIds: spec.members.map((memberKey) => this.botRef(memberKey).id),
      leadBotId: this.botRef(spec.lead).id,
      responder: spec.responder ?? 'lead',
    };
    const thread: Thread = await this.api.createRoom(input);
    this.threads.set(key, thread.id);
    this.roomKeys.add(key);
    this.rooms.push({ key, id: thread.id });
    return thread.id;
  }

  /** Creates a user MCP server and records it, so the runner deletes it even if the case crashes. */
  async createMcpServer(input: CreateMcpServerInput): Promise<McpServer> {
    const server = await this.api.createMcpServer(input);
    this.mcpServers.push({ name: server.name, id: server.id });
    this.settings.log(`${this.settings.caseId}: created MCP server ${server.name} ${server.id}`);
    return server;
  }

  /** A thread key is either a named thread, or `<botKey>:dm`, which is created on first use. */
  async resolveThread(threadKey: string): Promise<string> {
    if (threadKey.endsWith(':dm') && !this.threads.has(threadKey)) return this.dm(threadKey.slice(0, -3));
    return this.threadId(threadKey);
  }

  /** Posts a user message. Returns the first run's id, or null when a room has nobody to answer. */
  async say(threadKey: string, content: string, mentionKeys?: string[]): Promise<string | null> {
    this.throwIfStopped();
    const mentions = mentionKeys?.map((key) => this.botRef(key).id);
    return this.api.postMessage(await this.resolveThread(threadKey), content, mentions);
  }

  /**
   * Posts and waits. In a DM that is the reply's run. In a room the chain of responders is not known up front, so the
   * wait covers every case thread until nothing is busy.
   */
  async sayAndWait(threadKey: string, content: string, mentionKeys?: string[]): Promise<string | null> {
    const runId = await this.say(threadKey, content, mentionKeys);
    if (this.roomKeys.has(threadKey)) {
      await this.waitIdle();
    } else if (runId !== null) {
      await this.waitRun(await this.resolveThread(threadKey), runId);
    }
    return runId;
  }

  async waitRun(threadId: string, runId: string): Promise<Run> {
    for (;;) {
      const run = (await this.api.listRuns(threadId)).find((candidate) => candidate.id === runId);
      if (run !== undefined && !ACTIVE.has(run.status)) return run;
      this.assertTime(`run ${runId} to finish`);
      await sleep(this.settings.pollMs);
    }
  }

  /** Every thread the case's bots own or belong to, plus the named threads. */
  async allThreadIds(): Promise<string[]> {
    const ids = new Set<string>(this.threads.values());
    for (const bot of this.bots.values()) {
      for (const thread of [...(await this.api.botThreads(bot.id)), ...(await this.api.botRooms(bot.id))]) {
        ids.add(thread.id);
      }
    }
    return [...ids];
  }

  /** Why the case is still busy, or undefined when nothing is running and no approval waits for a person. */
  private async busyReason(): Promise<string | undefined> {
    for (const threadId of await this.allThreadIds()) {
      const running = (await this.api.listRuns(threadId)).find((run) => ACTIVE.has(run.status));
      if (running !== undefined) return `run ${running.id} is ${running.status}`;
    }
    const botIds = new Set(this.botIds());
    const pending = (await this.api.approvals('pending')).find((approval) => botIds.has(approval.botId));
    if (pending !== undefined) return `approval ${pending.id} (${pending.tool}) is pending`;
    // A task that is open or in progress has work still coming. A blocked task waits on someone else, so it does not hold the case.
    for (const bot of this.bots.values()) {
      const open = (await this.api.listTasks({ assigneeBotId: bot.id })).find(
        (task) => task.status === 'open' || task.status === 'in_progress',
      );
      if (open !== undefined) return `task "${open.title}" is ${open.status}`;
    }
    return undefined;
  }

  /**
   * Waits until the case's bots are quiet on two observations in a row. Rooms and tasks start their next run
   * in the background, so one quiet observation is not enough.
   */
  async waitIdle(): Promise<void> {
    let quiet = 0;
    for (;;) {
      const busy = await this.busyReason();
      quiet = busy === undefined ? quiet + 1 : 0;
      if (quiet >= 2) return;
      this.assertTime(busy ?? 'the case to go quiet');
      await sleep(this.settings.pollMs);
    }
  }

  /** Polls `probe` until it returns a value that is not false, undefined or null. */
  async waitFor<T>(label: string, probe: () => Promise<T | false | undefined | null>): Promise<T> {
    for (;;) {
      const value = await probe();
      if (value !== false && value !== undefined && value !== null) return value;
      this.assertTime(label);
      await sleep(this.settings.pollMs);
    }
  }

  /**
   * Makes sure the bot's computer exists and runs. A cheap warm-up run starts it when it does not. Fixture copies and
   * file checks need the container, so every computer helper calls this first.
   */
  async ensureComputer(botKey: string): Promise<string> {
    this.throwIfStopped();
    const bot = this.botRef(botKey);
    const name = computerName(bot.id);
    if (this.warm.has(botKey) && (await containerState(name)) === 'running') return name;
    const threadId = await this.dm(botKey);
    const runId = await this.api.postMessage(threadId, WARM_UP_MESSAGE);
    if (runId !== null) await this.waitRun(threadId, runId);
    const state = await containerState(name);
    if (state !== 'running') {
      throw new DockerError(
        `bot ${bot.name} has no running computer container (${name} is ${state}) after a warm-up run. ` +
          'Check that the server runs with Docker and that the sandbox image exists (brot-computer:latest).',
      );
    }
    this.warm.add(botKey);
    return name;
  }

  /** Copies a file from the repo's fixtures into the bot's workspace. `workspacePath` is relative to /workspace. */
  async copyIn(botKey: string, localPath: string, workspacePath: string): Promise<void> {
    const name = await this.ensureComputer(botKey);
    await copyIntoContainer(name, localPath, `${WORKSPACE}/${workspacePath}`);
  }

  /** Runs a shell command in the bot's computer, in /workspace. Output is cut to keep the report readable. */
  async exec(botKey: string, command: string, timeoutSec = 120): Promise<Exec> {
    const name = await this.ensureComputer(botKey);
    const result = await execIn(name, command, { timeoutMs: timeoutSec * 1000 });
    return { code: result.code, stdout: truncate(result.stdout, 4000), stderr: truncate(result.stderr, 2000) };
  }

  /** Marks a workspace file for the evidence. It is read after the run, and missing files stay `null`. */
  requestArtifact(botKey: string, path: string): void {
    this.artifactRequests.push({ botKey, path });
  }

  /** Keeps a whole workspace folder for human review. The runner copies it out after the run. */
  keepFolder(botKey: string, path: string): void {
    this.keptFolders.push({ botKey, path });
  }

  /** Reads a workspace file through docker cp into the run's artifact folder. Returns null when it is missing. */
  async readWorkspace(botKey: string, path: string): Promise<string | null> {
    const name = computerName(this.botRef(botKey).id);
    if ((await containerState(name)) !== 'running') return null;
    const local = join(this.settings.artifactsDir, this.settings.caseId, botKey, path);
    await mkdir(dirname(local), { recursive: true });
    const copied = await copyOutOfContainer(name, `${WORKSPACE}/${path}`, local);
    if (!copied) return null;
    return truncate(await readFile(local, 'utf8'), 200_000);
  }

  /** Stops the bot's computer container with SIGKILL, as a crash would. Used by C3. */
  async killComputer(botKey: string): Promise<void> {
    const result = await docker(['kill', computerName(this.botRef(botKey).id)]);
    if (result.code !== 0) throw new DockerError(`docker kill failed: ${result.stderr.trim()}`);
  }

  async createRoutine(
    key: string,
    input: { botKey: string; name: string; instruction: string; cron?: string },
  ): Promise<void> {
    const routine = await this.api.createRoutine({
      botId: this.botRef(input.botKey).id,
      name: input.name,
      instruction: input.instruction,
      trigger: { type: 'cron', cron: input.cron ?? CRON_EVERY_NIGHT },
      enabled: true,
    });
    this.routines.set(key, { id: routine.id, botKey: input.botKey, name: input.name });
  }

  /**
   * Fires a routine now, as the scheduler would, and waits for its run. The routine's thread is the one titled with
   * the routine's name.
   */
  async runRoutine(key: string): Promise<Run> {
    const routine = this.routines.get(key);
    if (routine === undefined) throw new Error(`no routine "${key}" in case ${this.settings.caseId}`);
    this.throwIfStopped();
    const fired = await this.api.runRoutine(routine.id);
    const botId = this.botRef(routine.botKey).id;
    const thread = (await this.api.botThreads(botId)).find((candidate) => candidate.title === routine.name);
    if (thread === undefined) throw new Error(`routine ${routine.name} has no thread after it ran`);
    return this.waitRun(thread.id, fired.runId);
  }

  async putSecret(name: string, value: string): Promise<void> {
    await this.api.putSecret(name, value);
    this.secretNames.push(name);
  }
}
