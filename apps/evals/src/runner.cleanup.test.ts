import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CanonicalEvent, Run, Thread } from '@brot/protocol';
import { BrotApi } from './api';
import type { RunOptions } from './args';
import { CaseTimeoutError, type BotSpec } from './context';
import { check } from './checks';
import { runCase, runEval } from './runner';
import type { Case, CheckResult } from './types';

type FailStep = 'deleteRoom' | 'deleteMcpServer' | 'deleteBot' | 'archiveBot';

// Keep the unit tests free of Docker: the runner only asks whether containers exist and removes them.
vi.mock('./docker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./docker')>();
  return {
    ...actual,
    requireDocker: async () => 'mocked',
    containerState: async () => 'missing',
    listBrotResources: async () => [],
    removeBotResources: async () => undefined,
    copyOutOfContainer: async () => false,
  };
});

/** The part of the Brot API a case touches, in memory, recording every cleanup call. */
class FakeServer {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  readonly rooms: Array<{ id: string; title: string; members: string[] }> = [];
  readonly mcpServers: Array<{ id: string; name: string }> = [];
  readonly bots: Array<{ id: string; name: string; engine: string }> = [];
  readonly threads: Array<{ id: string; botId: string }> = [];
  readonly runs: Run[] = [];
  readonly events: CanonicalEvent[] = [];
  private seq = 0;

  constructor(
    private readonly options: {
      costPerRunUsd?: number;
      hangs?: boolean;
      fail?: ReadonlySet<FailStep>;
    } = {},
  ) {}

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async health() {
    return { ok: true, version: '0.1.0', protocol: 1 };
  }

  async createBot(body: { name: string; engine: string }) {
    const bot = { id: this.next('bot'), name: body.name, engine: body.engine };
    this.bots.push(bot);
    return { ...bot, computer: 'none', egress: { mode: 'deny', allow: [] } };
  }

  async createPolicy() {
    return {};
  }

  async createThread(botId: string): Promise<Thread> {
    const thread = { id: this.next('thread'), botId, title: 'T', kind: 'dm', createdAt: '', updatedAt: '' };
    this.threads.push({ id: thread.id, botId });
    return thread as Thread;
  }

  async createRoom(input: { title: string; botIds: string[]; leadBotId: string }): Promise<Thread> {
    const room = { id: this.next('room'), title: input.title, members: input.botIds };
    this.rooms.push(room);
    return { id: room.id, botId: input.leadBotId, title: input.title, kind: 'room', createdAt: '', updatedAt: '' } as Thread;
  }

  async createMcpServer(input: { name: string }) {
    const server = { id: this.next('mcp'), name: input.name };
    this.mcpServers.push(server);
    return { ...server, transport: 'stdio', args: [], env: {}, enabled: true, createdAt: '', updatedAt: '' };
  }

  async deleteRoom(id: string): Promise<void> {
    this.record('deleteRoom', id);
    if (this.options.fail?.has('deleteRoom') === true) throw new Error('room delete failed');
  }

  async deleteMcpServer(id: string): Promise<void> {
    this.record('deleteMcpServer', id);
    if (this.options.fail?.has('deleteMcpServer') === true) throw new Error('mcp delete failed');
  }

  async deleteBot(id: string): Promise<void> {
    this.record('deleteBot', id);
    if (this.options.fail?.has('deleteBot') === true) throw new Error('bot delete failed');
  }

  async archiveBot(id: string): Promise<unknown> {
    this.record('archiveBot', id);
    if (this.options.fail?.has('archiveBot') === true) throw new Error('archive failed');
    return {};
  }

  async deleteSecret(name: string): Promise<void> {
    this.record('deleteSecret', name);
  }

  async botThreads(botId: string): Promise<Thread[]> {
    return this.threads.filter((thread) => thread.botId === botId) as unknown as Thread[];
  }

  async botRooms(botId: string): Promise<Thread[]> {
    return this.rooms
      .filter((room) => room.members.includes(botId))
      .map((room) => ({ id: room.id, botId, title: room.title, kind: 'room', createdAt: '', updatedAt: '' }) as Thread);
  }

  async postMessage(threadId: string): Promise<string> {
    const botId = this.threads.find((thread) => thread.id === threadId)?.botId ?? this.rooms.find((room) => room.id === threadId)?.members[0] ?? '';
    const runId = this.next('run');
    const at = new Date().toISOString();
    this.runs.push({ id: runId, threadId, botId, status: this.options.hangs ? 'running' : 'completed' } as unknown as Run);
    this.events.push({ id: this.next('ev'), type: 'message.completed', at, threadId, runId, message: { id: 'm', threadId, role: 'assistant', content: 'done', createdAt: at } } as CanonicalEvent);
    if (this.options.costPerRunUsd !== undefined) {
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
    }
    return runId;
  }

  async listRuns(threadId: string): Promise<Run[]> {
    return this.runs.filter((run) => run.threadId === threadId);
  }

  async cancelRun(runId: string): Promise<Run> {
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

  async listTasks(): Promise<[]> {
    return [];
  }

  async listMemories(): Promise<[]> {
    return [];
  }

  async approvals(): Promise<[]> {
    return [];
  }

  /** Methods recording calls, as the assertion target. */
  called(method: string): unknown[][] {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }
}

function apiFor(server: FakeServer): BrotApi {
  return server as unknown as BrotApi;
}

const spec: BotSpec = { name: 'Onça', job: 'Test', instructions: 'Test', species: 'onca', color: 'orange', egress: [] };

function optionsWith(overrides: Partial<RunOptions> = {}): RunOptions {
  return {
    base: 'http://127.0.0.1:1',
    model: 'opencode-go/deepseek-v4.1-flash',
    engine: 'dsh',
    out: join(tmpdir(), 'evals-runner-cleanup-test'),
    maxUsd: 5,
    maxCaseUsd: 1.5,
    caseTimeoutMs: 5_000,
    pollMs: 1,
    keepComputers: true,
    list: false,
    help: false,
    ...overrides,
  };
}

/** A case that creates one bot, one room and one MCP server, then posts one message. */
function resourceCase(checks: CheckResult[], run: (ctx: Parameters<Case['run']>[0]) => Promise<void> = async (ctx) => {
  await ctx.sayAndWait('onca:dm', 'do the work');
}): Case {
  return {
    id: 'T1',
    title: 'Cleanup case',
    status: 'now',
    async setup(ctx) {
      await ctx.createBot('onca', spec);
      await ctx.room('room', { title: 'Room', members: ['onca'], lead: 'onca' });
      await ctx.createMcpServer({ name: 'fixture', transport: 'stdio', command: 'node' });
    },
    run,
    check: () => checks,
  };
}

const pass = [check('ok', 'ok', true, 'fine')];
const fail = [check('bad', 'bad', false, 'broken')];

describe('cleanup after a case', () => {
  it('archives the bots of a passing case but always deletes its room and MCP server', async () => {
    const server = new FakeServer({ costPerRunUsd: 0.1 });
    const { outcome } = await runCase({ caseDef: resourceCase(pass), api: apiFor(server), options: optionsWith(), log: () => undefined });

    expect(outcome.status).toBe('pass');
    expect(server.called('archiveBot')).toHaveLength(1);
    expect(server.called('deleteBot')).toHaveLength(0);
    expect(server.called('deleteRoom')).toEqual([[server.rooms[0]?.id]]);
    expect(server.called('deleteMcpServer')).toEqual([[server.mcpServers[0]?.id]]);
  });

  it('deletes the bots, room and MCP server of a case that errored', async () => {
    const server = new FakeServer({ costPerRunUsd: 0.1 });
    const throwing: Case = {
      ...resourceCase(pass),
      async run() {
        throw new Error('the engine crashed');
      },
    };
    const { outcome } = await runCase({ caseDef: throwing, api: apiFor(server), options: optionsWith(), log: () => undefined });

    expect(outcome.status).toBe('error');
    expect(outcome.error).toMatch(/engine crashed/);
    expect(server.called('deleteBot')).toHaveLength(1);
    expect(server.called('archiveBot')).toHaveLength(0);
    expect(server.called('deleteRoom')).toHaveLength(1);
    expect(server.called('deleteMcpServer')).toHaveLength(1);
  });

  it('deletes the bots of a timed-out case even when its checks would fail', async () => {
    const server = new FakeServer({ costPerRunUsd: 0.1 });
    const timedOut: Case = {
      ...resourceCase(fail),
      async run() {
        throw new CaseTimeoutError('the case hit its deadline');
      },
    };
    const { outcome } = await runCase({ caseDef: timedOut, api: apiFor(server), options: optionsWith(), log: () => undefined });

    expect(outcome.status).toBe('error');
    expect(outcome.error).toMatch(/deadline/);
    expect(server.called('deleteBot')).toHaveLength(1);
    expect(server.called('archiveBot')).toHaveLength(0);
    expect(server.called('deleteRoom')).toHaveLength(1);
    expect(server.called('deleteMcpServer')).toHaveLength(1);
  });

  it('deletes the bots of a cost-stopped case', async () => {
    const server = new FakeServer({ costPerRunUsd: 2, hangs: true });
    const { outcome } = await runCase({
      caseDef: resourceCase(pass),
      api: apiFor(server),
      options: optionsWith({ maxCaseUsd: 0.1 }),
      log: () => undefined,
    });

    expect(outcome.status).toBe('stopped');
    expect(server.called('deleteBot')).toHaveLength(1);
    expect(server.called('archiveBot')).toHaveLength(0);
    expect(server.called('deleteRoom')).toHaveLength(1);
    expect(server.called('deleteMcpServer')).toHaveLength(1);
  });

  it('logs cleanup failures without changing the outcome', async () => {
    const server = new FakeServer({
      costPerRunUsd: 0.1,
      fail: new Set(['deleteRoom', 'deleteMcpServer', 'archiveBot']),
    });
    const logs: string[] = [];
    const { outcome } = await runCase({
      caseDef: resourceCase(pass),
      api: apiFor(server),
      options: optionsWith(),
      log: (line) => logs.push(line),
    });

    expect(outcome.status).toBe('pass');
    expect(logs.join('\n')).toContain('delete room room: room delete failed');
    expect(logs.join('\n')).toContain('delete MCP server fixture: mcp delete failed');
    expect(logs.join('\n')).toContain('archive Onça: archive failed');
  });

  it('keeps a case cleanup hook working: it can delete its own bots and empty the context', async () => {
    const server = new FakeServer({ costPerRunUsd: 0.1 });
    let botsAfterHook = -1;
    const hooked: Case = {
      ...resourceCase(pass),
      async cleanup(ctx) {
        for (const bot of ctx.bots.values()) await ctx.api.deleteBot(bot.id);
        ctx.bots.clear();
        botsAfterHook = ctx.bots.size;
      },
    };
    const { outcome } = await runCase({ caseDef: hooked, api: apiFor(server), options: optionsWith(), log: () => undefined });

    expect(outcome.status).toBe('pass');
    expect(botsAfterHook).toBe(0);
    expect(server.called('deleteBot')).toHaveLength(1);
    expect(server.called('archiveBot')).toHaveLength(0);
    // The hook does not stop the generic room/MCP cleanup.
    expect(server.called('deleteRoom')).toHaveLength(1);
    expect(server.called('deleteMcpServer')).toHaveLength(1);
  });

  it('does not run anything for a skipped case', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evals-skip-test-'));
    try {
      const server = new FakeServer();
      const skipped: Case = {
        id: 'X1',
        title: 'Later case',
        status: 'later',
        note: 'needs a feature',
        setup: async () => undefined,
        run: async () => undefined,
        check: () => [],
      };
      const results = await runEval({
        options: optionsWith({ out: dir, engine: 'mock' }),
        cases: [skipped],
        log: () => undefined,
        api: apiFor(server),
      });
      expect(results.cases[0]?.status).toBe('skipped');
      expect(server.calls).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
