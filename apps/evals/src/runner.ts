import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CanonicalEvent, type Memory, type Message, type Run, type Task } from '@brot/protocol';
import { BrotApi } from './api';
import { outputNames, type RunOptions } from './args';
import { ApprovalDriver, countInternalCalls, standardPolicy } from './approvals';
import { startBudgetGuard } from './budget';
import { CaseContext, CaseStoppedError, CaseTimeoutError, type RunSettings } from './context';
import {
  computerName,
  containerState,
  copyOutOfContainer,
  listBrotResources,
  removeBotResources,
  requireDocker,
  WORKSPACE,
} from './docker';
import { auditDecisions, sumCost } from './evidence';
import { renderReport, type ResultsFile } from './report';
import type { ApprovalRecord, BotRef, Case, CaseOutcome, Evidence } from './types';
import { errorMessage, truncate } from './util';

export type Logger = (line: string) => void;

/** What a held phase leaves on disk, so phase 2 can find its bots and threads after the restart. */
export interface HeldState {
  caseId: string;
  base: string;
  bots: Record<string, BotRef>;
  threads: Record<string, string>;
  state: unknown;
  savedAt: string;
}

export function statePath(outDir: string, caseId: string): string {
  return join(outDir, 'state', `${caseId}.json`);
}

export async function readHeldState(outDir: string, caseId: string): Promise<HeldState | undefined> {
  try {
    return JSON.parse(await readFile(statePath(outDir, caseId), 'utf8')) as HeldState;
  } catch {
    return undefined;
  }
}

/** Writes JSON through a temp file, so a crash never leaves a half-written results file. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, path);
}

export interface PreflightResult {
  serverVersion: string;
  protocol: number;
  dockerServer: string;
}

/** Checks the things a run needs before it spends anything: a server, a live engine, a key, and Docker. */
export async function preflight(api: BrotApi, options: RunOptions): Promise<PreflightResult> {
  let health: Awaited<ReturnType<BrotApi['health']>>;
  try {
    health = await api.health();
  } catch (error) {
    throw new Error(
      `No Brot server answers at ${api.base} (${errorMessage(error)}). Start one first, for example: ` +
        `BROT_HOME=$(mktemp -d) BROT_PORT=8821 pnpm --filter @brot/server start`,
      { cause: error },
    );
  }
  if (options.engine === 'dsh') {
    const engines = await api.engines();
    const dsh = engines.find((engine) => engine.id === 'dsh');
    if (dsh === undefined || !dsh.availability.available) {
      throw new Error(`The dsh engine is not available on ${api.base}: ${dsh?.availability.reason ?? 'not registered'}`);
    }
    const provider = options.model.split('/')[0] ?? '';
    const secrets = await api.listSecrets();
    if (!secrets.includes(provider)) {
      throw new Error(
        `The server has no key for provider "${provider}". Store it first: ` +
          `curl -X PUT ${api.base}/api/secrets/${provider} -H 'content-type: application/json' -d '{"value":"<key>"}'`,
      );
    }
  }
  const dockerServer = await requireDocker();
  return { serverVersion: health.version, protocol: health.protocol, dockerServer };
}

/** Cases that must not run, with the reason. Later and gap cases need a feature Brot does not have yet. */
export function skipReasonFor(caseDef: Case): string | undefined {
  if (caseDef.status === 'later') return `later: ${caseDef.note ?? 'needs a feature that is not built'}`;
  if (caseDef.status === 'gap') return `gap: ${caseDef.note ?? 'the product does not have this yet'}`;
  return undefined;
}

export function emptyOutcome(caseDef: Case): CaseOutcome {
  return {
    id: caseDef.id,
    title: caseDef.title,
    caseStatus: caseDef.status,
    status: 'skipped',
    needsReview: false,
    checks: [],
    runCount: 0,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    approvals: [],
    internalToolCalls: {},
    notableEvents: [],
    finalTexts: [],
  };
}

function isActive(run: Run): boolean {
  return run.status === 'running' || run.status === 'waiting_approval';
}

/** Describes the events a person would want to see first in the report. */
export function notableEventsOf(events: readonly CanonicalEvent[], botKeyOf: (id: string) => string): string[] {
  const notes: string[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'network.blocked':
        notes.push(`network.blocked: ${botKeyOf(event.botId)} tried ${event.host}`);
        break;
      case 'computer.status':
        if (event.state === 'error') notes.push(`computer.status: ${botKeyOf(event.botId)} error ${event.reason ?? ''}`);
        break;
      case 'run.failed':
        notes.push(`run.failed: ${truncate(event.error, 200)}`);
        break;
      case 'handoff':
        notes.push(`handoff: ${botKeyOf(event.fromBotId)} to ${botKeyOf(event.toBotId)}`);
        break;
      case 'task.updated':
        if (event.task.status === 'failed') notes.push(`task failed: ${truncate(event.task.title, 120)}`);
        break;
      default:
        break;
    }
  }
  return notes.slice(0, 60);
}

/** Collects everything the checks read: runs, events, messages, tasks, memories, approvals and artifacts. */
export async function collectEvidence(
  api: BrotApi,
  ctx: CaseContext,
  records: readonly ApprovalRecord[],
  caseId: string,
): Promise<Evidence> {
  const threadIds = await ctx.allThreadIds();
  const runs = new Map<string, Run>();
  const eventsByKey = new Map<string, CanonicalEvent>();
  let invalidEvents = 0;
  for (const threadId of threadIds) {
    for (const run of await api.listRuns(threadId)) runs.set(run.id, run);
    for (const raw of await api.threadEvents(threadId)) {
      const parsed = CanonicalEvent.safeParse(raw);
      if (!parsed.success) {
        invalidEvents += 1;
        continue;
      }
      eventsByKey.set(parsed.data.id, parsed.data);
    }
  }
  const events = [...eventsByKey.values()].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );

  const tasks = new Map<string, Task>();
  for (const bot of ctx.bots.values()) {
    for (const task of await api.listTasks({ assigneeBotId: bot.id })) tasks.set(task.id, task);
  }
  for (const threadId of threadIds) {
    for (const task of await api.listTasks({ threadId })) tasks.set(task.id, task);
  }

  const memories: Record<string, Memory[]> = {};
  for (const bot of ctx.bots.values()) memories[bot.key] = await api.listMemories(bot.id);

  const messages: Message[] = events.flatMap((event) => (event.type === 'message.completed' ? [event.message] : []));

  // Every approval on the case's bots should have passed through the runner. One the server resolved on its own was
  // decided by something other than the runner, and the report must show it.
  const botIds = new Set(ctx.botIds());
  const recorded = new Set(records.map((record) => record.approvalId));
  const unrecordedApprovals = (await api.approvals())
    .filter((approval) => botIds.has(approval.botId) && !recorded.has(approval.id))
    .map((approval) => approval.id);

  const finalByRun = new Map<string, { botKey: string; runId: string; threadId: string; text: string }>();
  for (const event of events) {
    if (event.type !== 'message.completed' || event.message.role !== 'assistant' || event.runId === undefined) continue;
    const botKey = ctx.botKeyOf(event.message.authorBotId ?? '') ?? event.message.authorBotId ?? 'unknown';
    finalByRun.set(event.runId, { botKey, runId: event.runId, threadId: event.threadId, text: event.message.content });
  }

  const artifacts: Record<string, string | null> = {};
  for (const request of ctx.artifactRequests) {
    artifacts[`${request.botKey}:${request.path}`] = await ctx.readWorkspace(request.botKey, request.path);
  }

  const bots = Object.fromEntries(ctx.bots.entries());
  return {
    caseId,
    bots,
    threads: Object.fromEntries(ctx.threads.entries()),
    threadIds,
    runs: [...runs.values()],
    events,
    invalidEvents,
    messages,
    tasks: [...tasks.values()],
    memories,
    approvals: [...records],
    unrecordedApprovals,
    artifacts,
    probes: { ...ctx.probes },
    notes: { ...ctx.notes },
    finalTexts: [...finalByRun.values()],
    timedOut: false,
  };
}

/** Cancels every run of the case that is still going, so nothing keeps spending after the case ends. */
async function cancelLeftovers(api: BrotApi, ctx: CaseContext): Promise<void> {
  for (const threadId of await ctx.allThreadIds()) {
    for (const run of await api.listRuns(threadId)) {
      if (isActive(run)) await api.cancelRun(run.id).catch(() => undefined);
    }
  }
}

/** Copies each bot's out/ folder and any kept folders into the report folder, for a human to read. Best effort. */
async function keepOutFolders(ctx: CaseContext, artifactsDir: string, caseId: string): Promise<void> {
  for (const bot of ctx.bots.values()) {
    const name = computerName(bot.id);
    if ((await containerState(name)) !== 'running') continue;
    const target = join(artifactsDir, caseId, bot.key);
    await mkdir(target, { recursive: true });
    const folders = ['out', ...ctx.keptFolders.filter((kept) => kept.botKey === bot.key).map((kept) => kept.path)];
    for (const folder of new Set(folders)) {
      await copyOutOfContainer(name, `${WORKSPACE}/${folder}`, target).catch(() => false);
    }
  }
}

/** Archives the case's bots and removes their computers. Bots stay in the database, archived, for the record. */
async function cleanupCase(
  api: BrotApi,
  bots: BotRef[],
  secrets: string[],
  keepComputers: boolean,
  log: Logger,
): Promise<void> {
  for (const bot of bots) {
    await api.archiveBot(bot.id).catch((error: unknown) => log(`archive ${bot.name}: ${errorMessage(error)}`));
  }
  for (const name of secrets) await api.deleteSecret(name).catch(() => undefined);
  if (keepComputers) return;
  for (const bot of bots) await removeBotResources(bot.id);
}

export interface CaseRunInput {
  caseDef: Case;
  api: BrotApi;
  options: RunOptions;
  log: Logger;
  resumeFrom?: HeldState;
  now?: () => Date;
  /** What the earlier cases of the run spent. The run cap is checked against this plus the case's own cost. */
  spentBeforeUsd?: number;
}

/** Runs one case, phase 1 or phase 2, and returns its outcome. Cleanup happens here unless the case is held. */
export async function runCase(
  input: CaseRunInput,
): Promise<{ outcome: CaseOutcome; botIds: string[]; held?: HeldState }> {
  const { caseDef, api, options, log } = input;
  const startedMs = Date.now();
  const outcome = emptyOutcome(caseDef);
  outcome.status = 'error';
  outcome.startedAt = new Date(startedMs).toISOString();
  if (caseDef.coveredBy !== undefined) outcome.coveredBy = caseDef.coveredBy;
  const timeoutMs = caseDef.timeoutMs ?? options.caseTimeoutMs;

  const artifactsDir = join(options.out, outputNames(options.suffix).artifacts);
  const settings: RunSettings = {
    caseId: caseDef.id,
    engine: options.engine,
    model: options.model,
    pollMs: options.pollMs,
    deadlineAt: startedMs + timeoutMs,
    outDir: options.out,
    artifactsDir,
    log,
  };
  const ctx = new CaseContext(api, settings);
  if (input.resumeFrom !== undefined) {
    for (const [key, bot] of Object.entries(input.resumeFrom.bots)) ctx.bots.set(key, bot);
    for (const [key, id] of Object.entries(input.resumeFrom.threads)) ctx.threads.set(key, id);
  }

  const driver = new ApprovalDriver(api, {
    caseId: caseDef.id,
    policy: caseDef.approvals ?? standardPolicy(),
    pollMs: options.pollMs,
    botIds: () => ctx.botIds(),
    botKeyOf: (botId) => ctx.botKeyOf(botId),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  driver.start();
  const guard = startBudgetGuard({
    api,
    limits: { caseUsd: options.maxCaseUsd, totalUsd: options.maxUsd, spentBeforeUsd: input.spentBeforeUsd ?? 0 },
    pollMs: options.pollMs,
    targets: { threadIds: () => ctx.allThreadIds(), botIds: () => ctx.botIds() },
    onStop: (reason) => ctx.stop(reason),
    log: (line) => log(`${caseDef.id}: ${line}`),
  });

  let phaseError: string | undefined;
  let timedOut = false;
  try {
    if (input.resumeFrom !== undefined) {
      if (caseDef.resumeRun === undefined) throw new Error(`${caseDef.id} has no phase 2`);
      await caseDef.resumeRun(ctx, input.resumeFrom.state);
    } else {
      await caseDef.setup(ctx);
      await caseDef.run(ctx);
    }
    // Phase 2 checks its own state: a held approval may stay pending on purpose, so waiting for quiet would never end.
    if (!ctx.holdRequested && input.resumeFrom === undefined) await ctx.waitIdle();
  } catch (error) {
    if (error instanceof CaseTimeoutError) timedOut = true;
    // A stop from the cost guard is a result, not an error. The reason is read below.
    if (!(error instanceof CaseStoppedError)) {
      phaseError = errorMessage(error);
      log(`${caseDef.id}: ${phaseError}`);
    }
  }

  await guard.stop();
  if (guard.errors.length > 0) log(`${caseDef.id}: cost guard errors: ${guard.errors.slice(0, 3).join('; ')}`);
  if (!ctx.holdRequested) await cancelLeftovers(api, ctx).catch(() => undefined);
  await driver.stop();
  if (driver.errors.length > 0) log(`${caseDef.id}: approval driver errors: ${driver.errors.slice(0, 3).join('; ')}`);

  let evidence: Evidence;
  try {
    evidence = await collectEvidence(api, ctx, driver.records, caseDef.id);
  } catch (error) {
    phaseError = `${phaseError ?? ''} evidence could not be collected: ${errorMessage(error)}`.trim();
    evidence = {
      caseId: caseDef.id,
      bots: Object.fromEntries(ctx.bots.entries()),
      threads: Object.fromEntries(ctx.threads.entries()),
      threadIds: [],
      runs: [],
      events: [],
      invalidEvents: 0,
      messages: [],
      tasks: [],
      memories: {},
      approvals: [...driver.records],
      artifacts: {},
      probes: { ...ctx.probes },
      notes: { ...ctx.notes },
      finalTexts: [],
      timedOut,
    };
  }
  evidence.timedOut = timedOut;
  if (phaseError !== undefined) evidence.errorMessage = phaseError;

  await keepOutFolders(ctx, artifactsDir, caseDef.id);

  const cost = sumCost(evidence.events);
  outcome.runCount = evidence.runs.length;
  outcome.costUsd = cost.costUsd;
  outcome.tokensIn = cost.tokensIn;
  outcome.tokensOut = cost.tokensOut;
  outcome.approvals = [...driver.records];
  outcome.internalToolCalls = countInternalCalls(evidence.events);
  outcome.notableEvents = notableEventsOf(evidence.events, (id) => ctx.botKeyOf(id) ?? id.slice(0, 8));
  outcome.finalTexts = evidence.finalTexts.map((entry) => ({ bot: entry.botKey, text: truncate(entry.text, 1200) }));

  if (ctx.holdRequested) {
    outcome.status = 'pending';
    outcome.instructions = ctx.instructions;
    const state: HeldState = {
      caseId: caseDef.id,
      base: api.base,
      bots: Object.fromEntries(ctx.bots.entries()),
      threads: Object.fromEntries(ctx.threads.entries()),
      state: ctx.notes.resumeState ?? null,
      savedAt: new Date().toISOString(),
    };
    await mkdir(join(options.out, 'state'), { recursive: true });
    await writeJsonAtomic(statePath(options.out, caseDef.id), state);
    outcome.checks = [];
    finish(outcome, startedMs);
    return { outcome, botIds: state.bots ? Object.values(state.bots).map((bot) => bot.id) : [], held: state };
  }

  // A stopped case is partial, so its checks would only report what was cut off. Its approvals and cost stay on record.
  const stopReason = ctx.stopReason;
  if (stopReason !== undefined) {
    outcome.status = 'stopped';
    outcome.stoppedBy = 'budget';
    outcome.error = stopReason;
  } else {
    try {
      outcome.checks = caseDef.check(evidence);
    } catch (error) {
      phaseError = `${phaseError ?? ''} check crashed: ${errorMessage(error)}`.trim();
      outcome.checks = [];
    }
    outcome.needsReview = outcome.checks.some((check) => check.status === 'review');
    if (phaseError !== undefined) outcome.error = phaseError;

    if (phaseError !== undefined) {
      outcome.status = 'error';
    } else if (outcome.checks.length === 0) {
      outcome.status = 'error';
      outcome.error = 'the case produced no checks';
    } else {
      outcome.status = outcome.checks.some((check) => check.status === 'fail') ? 'fail' : 'pass';
    }
  }

  const audit = auditDecisions(driver.records, evidence.events);
  if (audit.violations.length > 0) {
    outcome.checks.push({
      id: 'gate',
      label: 'No tool result before the approval decision',
      status: 'fail',
      evidence: audit.violations.map((violation) => `${violation.approvalId}: ${violation.detail}`).join('; '),
    });
    outcome.status = 'fail';
  }

  const bots = [...ctx.bots.values()];
  await cleanupCase(api, bots, ctx.secretNames, options.keepComputers, log);
  finish(outcome, startedMs);
  return { outcome, botIds: bots.map((bot) => bot.id) };
}

function finish(outcome: CaseOutcome, startedMs: number): void {
  outcome.finishedAt = new Date().toISOString();
  outcome.durationMs = Date.now() - startedMs;
}

export interface RunInput {
  options: RunOptions;
  cases: Case[];
  log: Logger;
  api?: BrotApi;
}

/**
 * Runs the selected cases in order, under the cost cap, and writes results.json and REPORT.md after each one, so a
 * crash keeps what already ran. A phase 2 run merges into the existing results; any other run starts a fresh file.
 */
export async function runEval(input: RunInput): Promise<ResultsFile> {
  const { options, cases, log } = input;
  const api = input.api ?? new BrotApi(options.base);
  await mkdir(options.out, { recursive: true });
  const info = await preflight(api, options);
  log(`server ${info.serverVersion} (protocol ${info.protocol}), docker ${info.dockerServer}, out ${options.out}`);

  const names = outputNames(options.suffix);
  const resultsPath = join(options.out, names.results);
  const previous =
    options.resume === undefined
      ? undefined
      : await readFile(resultsPath, 'utf8')
          .then((text) => JSON.parse(text) as ResultsFile)
          .catch(() => undefined);
  const outcomes = new Map<string, CaseOutcome>();
  for (const outcome of previous?.cases ?? []) outcomes.set(outcome.id, outcome);
  const botIds = new Set<string>();
  const heldCases: string[] = [];

  const writeResults = async (): Promise<void> => {
    const all = [...outcomes.values()];
    const totals = all.reduce(
      (sum, outcome) => ({
        costUsd: sum.costUsd + outcome.costUsd,
        tokensIn: sum.tokensIn + outcome.tokensIn,
        tokensOut: sum.tokensOut + outcome.tokensOut,
        runs: sum.runs + outcome.runCount,
      }),
      { costUsd: 0, tokensIn: 0, tokensOut: 0, runs: 0 },
    );
    const results: ResultsFile = {
      schema: 1,
      generatedAt: new Date().toISOString(),
      base: options.base,
      engine: options.engine,
      model: options.model,
      maxUsd: options.maxUsd,
      maxCaseUsd: options.maxCaseUsd,
      server: { version: info.serverVersion, protocol: info.protocol },
      dockerServer: info.dockerServer,
      totals,
      cases: all,
      leftovers: await leftoversOf([...botIds]),
    };
    await writeJsonAtomic(resultsPath, results);
    await writeFile(join(options.out, names.report), renderReport(results));
  };

  for (const caseDef of cases) {
    const skip = skipReasonFor(caseDef) ?? (caseDef.status === 'covered' ? caseDef.note ?? 'covered by tests' : undefined);
    if (skip !== undefined) {
      const outcome = emptyOutcome(caseDef);
      outcome.skipReason = skip;
      if (caseDef.coveredBy !== undefined) outcome.coveredBy = caseDef.coveredBy;
      outcomes.set(caseDef.id, outcome);
      log(`${caseDef.id}: skipped (${skip})`);
      await writeResults();
      continue;
    }

    const spent = [...outcomes.values()].reduce((sum, outcome) => sum + outcome.costUsd, 0);
    if (spent > options.maxUsd) {
      const outcome = emptyOutcome(caseDef);
      outcome.skipReason = `cost guard: spent $${spent.toFixed(4)}, over the $${options.maxUsd} cap`;
      outcomes.set(caseDef.id, outcome);
      log(`${caseDef.id}: ${outcome.skipReason}`);
      await writeResults();
      continue;
    }

    const resumeFrom = options.resume === caseDef.id ? await readHeldState(options.out, caseDef.id) : undefined;
    if (options.resume === caseDef.id && resumeFrom === undefined) {
      throw new Error(`no saved state for ${caseDef.id} in ${options.out}. Run phase 1 first with the same --out.`);
    }
    if (resumeFrom !== undefined && resumeFrom.base !== options.base) {
      log(`${caseDef.id}: note: phase 1 ran against ${resumeFrom.base}, phase 2 is against ${options.base}`);
    }

    log(`${caseDef.id}: ${caseDef.title}`);
    const { outcome, botIds: ids, held } = await runCase({
      caseDef,
      api,
      options,
      log,
      spentBeforeUsd: spent,
      ...(resumeFrom === undefined ? {} : { resumeFrom }),
    });
    for (const id of ids) botIds.add(id);
    outcomes.set(caseDef.id, outcome);
    const review = outcome.status === 'pass' && outcome.needsReview ? ' (needs-review)' : '';
    const stopped = outcome.stoppedBy === undefined ? '' : ` (${outcome.stoppedBy})`;
    log(`${caseDef.id}: ${outcome.status}${stopped}${review}, $${outcome.costUsd.toFixed(4)}`);
    await writeResults();
    if (held !== undefined) {
      heldCases.push(caseDef.id);
      log(`${caseDef.id}: held for the restart. Other cases keep running. After they finish: ${outcome.instructions ?? ''}`);
    }
  }

  await writeResults();
  if (heldCases.length > 0) {
    log(`waiting for a restart before phase 2 of ${heldCases.join(', ')}. Use the same --base and --out.`);
  }
  const finalResults = JSON.parse(await readFile(resultsPath, 'utf8')) as ResultsFile;
  return finalResults;
}

/** Leftover containers, networks and volumes of the run's bots. Empty when cleanup worked. */
async function leftoversOf(botIds: string[]): Promise<string[]> {
  if (botIds.length === 0) return [];
  const all = await listBrotResources().catch(() => [] as string[]);
  return all.filter((name) => botIds.some((id) => name.includes(id)));
}
