import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CanonicalEvent, Run } from '@brot/protocol';
import { BrotApi } from './api';
import type { RunOptions } from './args';
import { internalToolPolicies } from './approvals';
import { runCase } from './runner';
import { check } from './checks';
import type { BotSpec } from './context';
import type { Case, CheckResult } from './types';

interface FakeOptions {
  /** Cost each run reports, in one cost.updated event. */
  costPerRunUsd: number;
  /** Brot-internal tools a run calls, as tool.call events. */
  tools?: string[];
  /** A run that hangs stays `running` until it is cancelled, the way a long run looks to the runner. Default: completes. */
  hangs?: boolean;
}

/**
 * The part of the Brot REST API a case touches, in memory. A run's cost arrives as a `cost.updated` event on its thread.
 */
class FakeServer {
  readonly policies: Array<{ botId: string; tool: string; effect: string }> = [];
  readonly cancelled: string[] = [];
  readonly patched: Array<{ id: string; status: string }> = [];
  private readonly threads: Array<{ id: string; botId: string }> = [];
  private readonly runs: Run[] = [];
  private readonly events: CanonicalEvent[] = [];
  private seq = 0;

  constructor(private readonly options: FakeOptions) {}

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  async createBot(body: { name: string; engine: string }) {
    return { id: this.next('bot'), name: body.name, engine: body.engine };
  }

  async createPolicy(botId: string, input: { tool: string; effect: string }) {
    this.policies.push({ botId, tool: input.tool, effect: input.effect });
    return input;
  }

  async createThread(botId: string) {
    const thread = { id: this.next('thread'), botId };
    this.threads.push(thread);
    return thread;
  }

  async botThreads(botId: string) {
    return this.threads.filter((thread) => thread.botId === botId);
  }

  async botRooms() {
    return [];
  }

  async postMessage(threadId: string): Promise<string> {
    const bot = this.threads.find((thread) => thread.id === threadId)?.botId ?? '';
    const runId = this.next('run');
    this.runs.push({ id: runId, threadId, botId: bot, status: this.options.hangs ? 'running' : 'completed' } as unknown as Run);
    const at = new Date().toISOString();
    for (const tool of this.options.tools ?? []) {
      this.events.push({ id: this.next('ev'), type: 'tool.call', at, threadId, runId, callId: this.next('call'), tool, args: {} } as CanonicalEvent);
    }
    this.events.push({
      id: this.next('ev'),
      type: 'cost.updated',
      at,
      threadId,
      runId,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: this.options.costPerRunUsd,
    } as CanonicalEvent);
    return runId;
  }

  async listRuns(threadId: string): Promise<Run[]> {
    return this.runs.filter((run) => run.threadId === threadId);
  }

  async cancelRun(runId: string): Promise<Run> {
    this.cancelled.push(runId);
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (run) run.status = 'cancelled';
    return run as Run;
  }

  async threadEvents(threadId: string): Promise<CanonicalEvent[]> {
    return this.events.filter((event) => event.threadId === threadId);
  }

  async threadEventsAfter(threadId: string, after: string | undefined): Promise<CanonicalEvent[]> {
    const mine = this.events.filter((event) => event.threadId === threadId);
    if (after === undefined) return mine;
    const index = mine.findIndex((event) => event.id === after);
    return index < 0 ? mine : mine.slice(index + 1);
  }

  async listTasks() {
    return [];
  }

  async patchTask(id: string, status: string) {
    this.patched.push({ id, status });
    return { id, status };
  }

  async listMemories() {
    return [];
  }

  async approvals() {
    return [];
  }

  async archiveBot() {
    return {};
  }

  async deleteSecret() {
    return undefined;
  }
}

function serverFor(options: FakeOptions): { server: FakeServer; api: BrotApi } {
  const server = new FakeServer(options);
  // The fake implements the methods the runner calls; the class type has private fields, so it is cast once here.
  return { server, api: server as unknown as BrotApi };
}

const spec: BotSpec = { name: 'Onça', job: 'Test', instructions: 'Test', species: 'onca', color: 'orange', egress: [] };

/** A case that starts one run and waits for it, so the cost guard has something to watch. */
function oneRunCase(checks: CheckResult[] = [check('ok', 'ok', true, 'fine')]): Case {
  return {
    id: 'T1',
    title: 'Test case',
    status: 'now',
    async setup(ctx) {
      await ctx.createBot('onca', spec);
    },
    async run(ctx) {
      await ctx.sayAndWait('onca:dm', 'do the work');
    },
    check: () => checks,
  };
}

function optionsWith(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    base: 'http://127.0.0.1:1',
    model: 'opencode-go/deepseek-v4.1-flash',
    engine: 'dsh',
    out: join(tmpdir(), 'evals-runner-stop-test'),
    maxUsd: 5,
    maxCaseUsd: 1.5,
    caseTimeoutMs: 10_000,
    pollMs: 1,
    keepComputers: true,
    list: false,
    help: false,
    ...overrides,
  };
}

describe('runCase under the cost guard', () => {
  it('stops a case that spends over its own cap, cancels its run, and skips the checks', async () => {
    const { server, api } = serverFor({ costPerRunUsd: 2, hangs: true });
    const { outcome } = await runCase({ caseDef: oneRunCase(), api, options: optionsWith(), log: () => undefined });
    expect(outcome.status).toBe('stopped');
    expect(outcome.stoppedBy).toBe('budget');
    expect(outcome.error).toMatch(/per-case cap \(--max-case-usd\)/);
    expect(outcome.checks).toEqual([]);
    expect(outcome.costUsd).toBeCloseTo(2, 6);
    expect(server.cancelled.length).toBeGreaterThan(0);
  });

  it('stops a case that takes the run over its total cap even when the case is under its own', async () => {
    const { api } = serverFor({ costPerRunUsd: 1, hangs: true });
    const { outcome } = await runCase({
      caseDef: oneRunCase(),
      api,
      options: optionsWith(),
      log: () => undefined,
      spentBeforeUsd: 4.5,
    });
    expect(outcome.status).toBe('stopped');
    expect(outcome.error).toMatch(/the run spent \$5\.5000 in total, over the \$5 cap \(--max-usd\)/);
  });

  it('runs the checks when the case stays inside both budgets', async () => {
    const { api } = serverFor({ costPerRunUsd: 0.4, tools: ['list_team'] });
    const { outcome } = await runCase({ caseDef: oneRunCase(), api, options: optionsWith(), log: () => undefined, spentBeforeUsd: 1 });
    expect(outcome.status).toBe('pass');
    expect(outcome.checks).toEqual([expect.objectContaining({ id: 'ok', status: 'pass' })]);
    expect(outcome.internalToolCalls).toEqual({ list_team: 1 });
  });

  it('gives every eval bot the Brot-internal tool policies when it is created', async () => {
    const { server, api } = serverFor({ costPerRunUsd: 0.1 });
    await runCase({ caseDef: oneRunCase(), api, options: optionsWith(), log: () => undefined });
    const expected = internalToolPolicies().map((policy) => policy.tool);
    expect(server.policies.map((policy) => policy.tool)).toEqual(expected);
    expect(new Set(server.policies.map((policy) => policy.effect))).toEqual(new Set(['allow']));
  });
});
