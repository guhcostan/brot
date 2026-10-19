import { Hono } from 'hono';
import { createEngineRegistry } from '@brot/engines';
import type { ComputerHandle, CanonicalEvent, EngineDriver, EngineEvent, McpServerSpec, RunContext } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApprovalScope } from './broker';
import type { ComputerProvider } from './computers/types';
import type { BrotMcpService } from './mcp/types';
import { createTestContext, recordEvents, waitUntil, type TestContext } from './testing';

const contexts: TestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
});

async function contextWith(options: Parameters<typeof createTestContext>[0] = {}): Promise<TestContext> {
  const ctx = await createTestContext(options);
  contexts.push(ctx);
  return ctx;
}

type Steps = (ctx: RunContext) => AsyncGenerator<EngineEvent>;

interface FakeEngine {
  driver: EngineDriver;
  /** Every run's context, in order. */
  contexts: RunContext[];
  closes: number;
}

/** A driver that plays `steps` for every run. Registered as `dsh` so the DSH model hosts apply to its bots. */
function fakeEngine(steps: Steps, id = 'dsh'): FakeEngine {
  const fake: FakeEngine = { driver: undefined as unknown as EngineDriver, contexts: [], closes: 0 };
  fake.driver = {
    id,
    label: id,
    detect: async () => ({ available: true }),
    models: async () => [],
    run(ctx) {
      fake.contexts.push(ctx);
      return steps(ctx);
    },
    close: async () => {
      fake.closes += 1;
    },
  };
  return fake;
}

const replies: Steps = async function* () {
  yield { type: 'text.delta', delta: 'hello' };
};

interface FakeProvider {
  provider: ComputerProvider;
  ensures: Array<{ botId: string; extraHosts: string[]; onBlocked(host: string): void }>;
  closes: number;
}

function fakeProvider(id: ComputerProvider['id'], options: { unavailable?: string; ensureError?: string } = {}): FakeProvider {
  const fake: FakeProvider = { provider: undefined as unknown as ComputerProvider, ensures: [], closes: 0 };
  const handle: ComputerHandle = { id: `${id}-computer`, exec: () => Promise.reject(new Error('not used')) };
  fake.provider = {
    id,
    available: async () => (options.unavailable ? { ok: false, reason: options.unavailable } : { ok: true }),
    ensure: async (bot, opts) => {
      fake.ensures.push({ botId: bot.id, ...opts });
      if (options.ensureError) throw new Error(options.ensureError);
      return handle;
    },
    internalEndpoint: () => ({ url: 'http://host.docker.internal:8799' }),
    stop: async () => undefined,
    close: async () => {
      fake.closes += 1;
    },
  };
  return fake;
}

interface FakeMcp {
  mcp: BrotMcpService;
  specs: Array<{ scope: ApprovalScope; baseUrl: string }>;
  ended: string[];
}

function fakeMcp(): FakeMcp {
  const fake: FakeMcp = { mcp: undefined as unknown as BrotMcpService, specs: [], ended: [] };
  fake.mcp = {
    specForRun(scope, baseUrl): McpServerSpec {
      fake.specs.push({ scope, baseUrl });
      return { name: 'brot', url: `${baseUrl}/mcp/runs/${scope.runId}`, headers: {} };
    },
    endRun(runId) {
      fake.ended.push(runId);
    },
    lastDecisions: [],
    route: new Hono(),
  };
  return fake;
}

async function botAndThread(ctx: TestContext, overrides: { computer?: 'none' | 'sandbox' | 'host'; engine?: string; hostAcknowledged?: boolean } = {}) {
  const bot = await ctx.services.repos.bots.create({
    name: 'Ada',
    job: 'Testing',
    engine: overrides.engine ?? 'dsh',
    computer: overrides.computer ?? 'none',
    hostAcknowledged: overrides.hostAcknowledged,
  });
  const thread = await ctx.services.repos.threads.create(bot.id);
  return { bot, threadId: thread.id };
}

/** Starts a run and waits for its terminal event. */
async function runToEnd(ctx: TestContext, threadId: string, input = 'hello') {
  const recorded = recordEvents(ctx.services.bus, threadId);
  try {
    const { runId } = await ctx.services.harness.startRun(threadId, input);
    const terminal = await waitUntil(() =>
      recorded.list.find(
        (event): event is Extract<CanonicalEvent, { type: 'run.completed' | 'run.failed' }> =>
          (event.type === 'run.completed' || event.type === 'run.failed') && event.runId === runId,
      ),
    );
    return { runId, terminal, events: [...recorded.list] };
  } finally {
    recorded.stop();
  }
}

describe('contained runs: placement', () => {
  it('fails a sandbox run when no sandbox provider is configured, and never falls back to host', async () => {
    const host = fakeProvider('host');
    const engine = fakeEngine(replies);
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { host: host.provider },
    });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.failed');
    expect(terminal.type === 'run.failed' && terminal.error).toMatch(/sandbox computer.*no sandbox computer provider/);
    expect(engine.contexts).toHaveLength(0);
    expect(host.ensures).toHaveLength(0);
    expect(await ctx.services.repos.computers.getByBot(bot.id)).toMatchObject({ state: 'error' });
  });

  it('gives a none bot no computer and reaches Brot MCP on the server loopback', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const { mcp, specs } = fakeMcp();
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
      mcp: () => mcp,
    });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });

    const { runId, terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.completed');
    expect(engine.contexts[0]).not.toHaveProperty('computer');
    expect(sandbox.ensures).toHaveLength(0);
    expect(specs).toEqual([
      { scope: { botId: expect.any(String), threadId, runId }, baseUrl: `http://127.0.0.1:${ctx.services.config.port}` },
    ]);
    expect(engine.contexts[0]?.mcpServers).toEqual([
      { name: 'brot', url: `http://127.0.0.1:${ctx.services.config.port}/mcp/runs/${runId}`, headers: {} },
    ]);
  });

  it('refuses a host computer outside desktop mode, even when a host provider is configured', async () => {
    const host = fakeProvider('host');
    const engine = fakeEngine(replies);
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { host: host.provider },
      mode: 'server',
    });
    const { threadId } = await botAndThread(ctx, { computer: 'host', hostAcknowledged: true });

    const { terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type === 'run.failed' && terminal.error).toMatch(/desktop/);
    expect(host.ensures).toHaveLength(0);
    expect(engine.contexts).toHaveLength(0);
  });

  it('runs a host computer in desktop mode', async () => {
    const host = fakeProvider('host');
    const engine = fakeEngine(replies);
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { host: host.provider },
      mode: 'desktop',
    });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'host', hostAcknowledged: true });

    const { terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.completed');
    expect(host.ensures.map((call) => call.botId)).toEqual([bot.id]);
    expect(await ctx.services.repos.computers.getByBot(bot.id)).toMatchObject({ state: 'ready', image: 'host' });
  });

  it('fails the run when the provider reports the computer unavailable', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker', { unavailable: 'Docker daemon is not running' });
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type === 'run.failed' && terminal.error).toContain('Docker daemon is not running');
    expect(engine.contexts).toHaveLength(0);
  });
});

describe('contained runs: computer state and egress', () => {
  it('starts a sandbox computer with the DSH model hosts and reports its state', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { terminal, events } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.completed');
    expect(sandbox.ensures).toEqual([
      expect.objectContaining({ botId: bot.id, extraHosts: ['api.deepseek.com'] }),
    ]);
    expect(engine.contexts[0]?.computer).toEqual(expect.objectContaining({ id: 'docker-computer' }));
    expect(await ctx.services.repos.computers.getByBot(bot.id)).toMatchObject({ state: 'ready', image: 'brot-computer:latest' });
    expect(
      events
        .filter((event) => event.type === 'computer.status')
        .map((event) => event.type === 'computer.status' && event.state),
    ).toEqual(['starting', 'ready']);
  });

  it('keeps a warm computer quiet: no status events on later runs', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    await runToEnd(ctx, threadId);
    const second = await runToEnd(ctx, threadId);

    expect(second.events.filter((event) => event.type === 'computer.status')).toEqual([]);
    expect(sandbox.ensures).toHaveLength(2);
  });

  it('persists and emits an error state when the computer fails to start', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker', { ensureError: 'image not found' });
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { terminal, events } = await runToEnd(ctx, threadId);

    expect(terminal.type === 'run.failed' && terminal.error).toContain('image not found');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'computer.status', state: 'error', reason: expect.stringContaining('image not found') }),
    );
    expect(await ctx.services.repos.computers.getByBot(bot.id)).toMatchObject({ state: 'error' });
  });

  it('reports blocked egress as network.blocked on the thread that started the computer', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const recorded = recordEvents(ctx.services.bus, threadId);
    try {
      await runToEnd(ctx, threadId);
      sandbox.ensures[0]?.onBlocked('tracker.example.net');
      const blocked = await waitUntil(() =>
        recorded.list.find((event) => event.type === 'network.blocked'),
      );
      expect(blocked).toMatchObject({ type: 'network.blocked', threadId, botId: bot.id, host: 'tracker.example.net' });
    } finally {
      recorded.stop();
    }
  });

  it('gives an engine with no model hosts an empty extraHosts list', async () => {
    const engine = fakeEngine(replies, 'mock');
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { threadId } = await botAndThread(ctx, { computer: 'sandbox', engine: 'mock' });

    await runToEnd(ctx, threadId);

    expect(sandbox.ensures[0]?.extraHosts).toEqual([]);
  });
});

describe('contained runs: MCP', () => {
  it('builds the MCP server from this server\'s own broker, repos, bus and vault', async () => {
    const { mcp } = fakeMcp();
    const seen: unknown[] = [];
    const ctx = await contextWith({
      mcp: (core) => {
        seen.push(core);
        return mcp;
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      repos: ctx.services.repos,
      bus: ctx.services.bus,
      broker: ctx.services.broker,
      vault: ctx.services.vault,
    });
  });

  it('attaches the run MCP server at the sandbox endpoint, and ends it when the run completes', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const { mcp, specs, ended } = fakeMcp();
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
      mcp: () => mcp,
    });
    const { threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { runId, terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.completed');
    expect(specs[0]?.baseUrl).toBe('http://host.docker.internal:8799');
    expect(engine.contexts[0]?.mcpServers).toEqual([
      { name: 'brot', url: `http://host.docker.internal:8799/mcp/runs/${runId}`, headers: {} },
    ]);
    expect(ended).toEqual([runId]);
  });

  it('ends the MCP run when the run fails', async () => {
    const engine = fakeEngine(async function* (ctx) {
      if (ctx.input === 'boom') throw new Error('model down');
      yield { type: 'text.delta', delta: 'fine' };
    });
    const { mcp, ended } = fakeMcp();
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]), mcp: () => mcp });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });

    const { runId, terminal } = await runToEnd(ctx, threadId, 'boom');

    expect(terminal.type === 'run.failed' && terminal.error).toContain('model down');
    expect(ended).toEqual([runId]);
  });

  it('ends the MCP run when the run is cancelled', async () => {
    const engine = fakeEngine(async function* (ctx) {
      yield { type: 'text.delta', delta: 'thinking' };
      await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve));
    });
    const { mcp, ended } = fakeMcp();
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]), mcp: () => mcp });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });

    const recorded = recordEvents(ctx.services.bus, threadId);
    try {
      const { runId } = await ctx.services.harness.startRun(threadId, 'wait');
      await waitUntil(() => recorded.list.find((event) => event.type === 'message.delta'));
      await ctx.services.harness.cancelRun(runId);

      expect(ended).toEqual([runId]);
    } finally {
      recorded.stop();
    }
  });
});

describe('contained runs: engine sessions', () => {
  it('persists the engine session and passes it to the next run of the thread', async () => {
    let turn = 0;
    const engine = fakeEngine(async function* () {
      turn += 1;
      if (turn === 1) yield { type: 'engine.session', sessionId: 'sess-1' };
      yield { type: 'text.delta', delta: 'ok' };
    });
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]) });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });

    await runToEnd(ctx, threadId);
    expect((await ctx.services.repos.threads.get(threadId))?.engineSessionId).toBe('sess-1');

    await runToEnd(ctx, threadId);
    expect(engine.contexts[0]?.engineSessionId).toBeUndefined();
    expect(engine.contexts[1]?.engineSessionId).toBe('sess-1');
  });

  it('forgets the engine sessions of a bot when the harness is asked to reset them', async () => {
    const engine = fakeEngine(async function* () {
      yield { type: 'engine.session', sessionId: 'sess-2' };
    });
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });

    await runToEnd(ctx, threadId);
    await ctx.services.harness.resetEngineSessions(bot.id);
    expect((await ctx.services.repos.threads.get(threadId))?.engineSessionId).toBeUndefined();

    await runToEnd(ctx, threadId);
    expect(engine.contexts[1]?.engineSessionId).toBeUndefined();
  });

  it('forgets a bot\'s engine sessions in rooms, and leaves the sessions of other bots alone', async () => {
    const engine = fakeEngine(async function* () {
      yield { type: 'engine.session', sessionId: 'sess-room' };
    });
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]) });
    const { bot } = await botAndThread(ctx, { computer: 'none' });
    const other = await ctx.services.repos.bots.create({ name: 'Bea', job: 'Testing', engine: 'dsh', computer: 'none' });
    const room = await ctx.services.repos.rooms.create({
      title: 'Team',
      botIds: [bot.id, other.id],
      leadBotId: bot.id,
      responder: 'lead',
    });
    await ctx.services.repos.threadSessions.set(room.id, bot.id, 'sess-ada');
    await ctx.services.repos.threadSessions.set(room.id, other.id, 'sess-bea');

    await ctx.services.harness.resetEngineSessions(bot.id);

    expect(await ctx.services.repos.threadSessions.get(room.id, bot.id)).toBeUndefined();
    expect(await ctx.services.repos.threadSessions.get(room.id, other.id)).toBe('sess-bea');
  });
});

describe('services shutdown', () => {
  it('closes engines and computer providers once, however often close is called', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const host = fakeProvider('host');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider, host: host.provider },
    });

    await ctx.services.close();
    await ctx.services.close();

    expect(engine.closes).toBe(1);
    expect(sandbox.closes).toBe(1);
    expect(host.closes).toBe(1);
  });

  it('closes a provider shared by both kinds once', async () => {
    const shared = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([fakeEngine(replies).driver]),
      computers: { sandbox: shared.provider, host: shared.provider },
    });

    await ctx.services.close();

    expect(shared.closes).toBe(1);
  });
});

