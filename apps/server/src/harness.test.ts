import { Hono } from 'hono';
import { createEngineRegistry } from '@brot/engines';
import type { ComputerHandle, CanonicalEvent, EngineDriver, EngineEvent, McpServerSpec, RunContext } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApprovalScope } from './broker';
import type { ComputerProvider } from './computers/types';
import type { ProviderSpec } from './llm';
import type { BrotMcpService } from './mcp/types';
import { createTestContext, recordEvents, waitUntil, type TestContext } from './testing';

const contexts: TestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
});

/** The provider the test DSH bots use. Its key is set on every test context. */
const FAKE_PROVIDER: ProviderSpec = {
  id: 'fake',
  api: 'openai-completions',
  baseUrl: 'https://fake.example/v1',
  secretName: 'fake',
};

/** Tests that never reach a provider get this fetch, so an accidental call fails loudly. */
async function refuseFetch(): Promise<Response> {
  throw new Error('the harness tests do not reach a provider');
}

async function contextWith(options: Parameters<typeof createTestContext>[0] = {}): Promise<TestContext> {
  const ctx = await createTestContext({
    ...options,
    llm: { providers: [FAKE_PROVIDER], fetch: refuseFetch, ...options.llm },
  });
  await ctx.services.vault.set('fake', 'sk-harness-test');
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

/** A bot on `dsh` by default, with a model on the fake provider. `model: null` gives a bot with no model. */
async function botAndThread(
  ctx: TestContext,
  overrides: { computer?: 'none' | 'sandbox' | 'host'; engine?: string; hostAcknowledged?: boolean; model?: string | null } = {},
) {
  const bot = await ctx.services.repos.bots.create({
    name: 'Ada',
    job: 'Testing',
    engine: overrides.engine ?? 'dsh',
    computer: overrides.computer ?? 'none',
    hostAcknowledged: overrides.hostAcknowledged,
    ...(overrides.model === null ? {} : { model: overrides.model ?? 'fake/model-1' }),
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
  it('starts a sandbox computer with no model hosts, since the model goes through the relay', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { terminal, events } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.completed');
    expect(sandbox.ensures).toEqual([expect.objectContaining({ botId: bot.id, extraHosts: [] })]);
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


describe('model relay for DSH runs', () => {
  it('gives a run on a sandbox computer a route through the computer endpoint, bound to the run token', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { runId, terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.completed');
    expect(engine.contexts[0]?.llm).toEqual({
      provider: 'fake',
      model: 'model-1',
      api: 'openai-completions',
      baseUrl: `http://host.docker.internal:8799/llm/runs/${runId}/v1`,
      token: expect.any(String),
    });
  });

  it('routes a computer-less run through the loopback server', async () => {
    const engine = fakeEngine(replies);
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]) });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });

    const { runId } = await runToEnd(ctx, threadId);

    expect(engine.contexts[0]?.llm?.baseUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/llm/runs/${runId}/v1$`));
  });

  it('relays the engine model calls, sends the key upstream, and counts their usage as cost', async () => {
    const upstreamCalls: Array<{ url: string; authorization: string | null }> = [];
    let ctx!: TestContext;
    const engine = fakeEngine(async function* (run) {
      const route = run.llm;
      if (route === undefined) throw new Error('the run has no llm route');
      const path = `${new URL(route.baseUrl).pathname}/chat/completions`;
      const res = await ctx.services.llm.route.request(path, {
        method: 'POST',
        headers: { authorization: `Bearer ${route.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: route.model, messages: [] }),
      });
      // Usage is reported when the body ends, so the engine reads it, as a real client does.
      yield { type: 'text.delta', delta: `${res.status} ${await res.text()}` };
      // A relayed run is counted from the relay, so this engine usage must not be added.
      yield { type: 'usage', tokensIn: 999, tokensOut: 999, costUsd: 9 };
    });
    ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      llm: {
        providers: [{ ...FAKE_PROVIDER, models: [{ id: 'model-1', cost: { input: 1, output: 2 } }] }],
        fetch: async (url, init) => {
          upstreamCalls.push({ url, authorization: new Headers(init.headers).get('authorization') });
          return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
        },
      },
    });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });

    const { runId, terminal, events } = await runToEnd(ctx, threadId);

    expect(terminal.type).toBe('run.completed');
    expect(upstreamCalls).toEqual([{ url: 'https://fake.example/v1/chat/completions', authorization: 'Bearer sk-harness-test' }]);
    const costs = events.filter((event) => event.type === 'cost.updated');
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ runId, tokensIn: 10, tokensOut: 5 });
    expect(costs[0]?.type === 'cost.updated' && costs[0].costUsd).toBeCloseTo(0.00002, 12);
    expect(await ctx.services.repos.runs.get(runId)).toMatchObject({ tokensIn: 10, tokensOut: 5 });
  });

  it('accepts the run token while the run is live and refuses it once the run ends', async () => {
    let ctx!: TestContext;
    let liveStatus = 0;
    const engine = fakeEngine(async function* (run) {
      const route = run.llm;
      if (route === undefined) throw new Error('the run has no llm route');
      const res = await ctx.services.llm.route.request(`${new URL(route.baseUrl).pathname}/models`, {
        headers: { authorization: `Bearer ${route.token}` },
      });
      liveStatus = res.status;
      yield { type: 'text.delta', delta: 'ok' };
    });
    ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      llm: { fetch: async () => Response.json({ data: [] }) },
    });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });

    const { runId } = await runToEnd(ctx, threadId);
    const token = engine.contexts[0]?.llm?.token ?? '';
    const after = await ctx.services.llm.route.request(`/llm/runs/${runId}/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(liveStatus).toBe(200);
    expect(after.status).toBe(401);
  });

  it('serves the relay to a remote caller that presents only the run token', async () => {
    const ctx = await contextWith({ llm: { fetch: async () => Response.json({ data: [] }) } });
    const token = ctx.services.llm.issue('run-remote', await ctx.services.llm.resolve('fake/model-1'));

    const served = await ctx.remote.request('/llm/runs/run-remote/v1/models', { headers: { authorization: `Bearer ${token}` } });
    const refused = await ctx.remote.request('/llm/runs/run-remote/v1/models');

    expect(served.status).toBe(200);
    expect(refused.status).toBe(401);
  });

  it('fails the run before any computer starts when the bot has no model', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    const { threadId } = await botAndThread(ctx, { computer: 'sandbox', model: null });

    const { terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type === 'run.failed' && terminal.error).toContain('has no model');
    expect(sandbox.ensures).toEqual([]);
    expect(engine.contexts).toEqual([]);
  });

  it('fails the run, naming the secret and how to add it, when the vault lacks the provider key', async () => {
    const engine = fakeEngine(replies);
    const sandbox = fakeProvider('docker');
    const ctx = await contextWith({
      engines: createEngineRegistry([engine.driver]),
      computers: { sandbox: sandbox.provider },
    });
    await ctx.services.vault.delete('fake');
    const { threadId } = await botAndThread(ctx, { computer: 'sandbox' });

    const { terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type === 'run.failed' && terminal.error).toContain('secret://fake');
    expect(terminal.type === 'run.failed' && terminal.error).toContain('PUT /api/secrets/fake');
    expect(sandbox.ensures).toEqual([]);
    expect(engine.contexts).toEqual([]);
  });

  it('fails the run when the model names a provider that is not configured', async () => {
    const engine = fakeEngine(replies);
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    await ctx.services.repos.bots.update(bot.id, { model: 'nope/model-1' });

    const { terminal } = await runToEnd(ctx, threadId);

    expect(terminal.type === 'run.failed' && terminal.error).toContain('Unknown model provider "nope"');
    expect(engine.contexts).toEqual([]);
  });
});

/**
 * An engine whose runs wait at a gate until the test releases them by input. The gate ignores the run's abort
 * signal, as an engine that is still stopping does, so the test decides when each engine turn ends.
 */
function gatedEngine(): { engine: FakeEngine; started: string[]; release(input: string): void } {
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const engine = fakeEngine(async function* (ctx) {
    started.push(ctx.input);
    await new Promise<void>((resolve) => gates.set(ctx.input, resolve));
    if (ctx.signal.aborted) return;
    yield { type: 'text.delta', delta: `answer to ${ctx.input}` };
  });
  return { engine, started, release: (input) => gates.get(input)?.() };
}

describe('run queue', () => {
  it('queues a second run for the same bot in the same thread until the first ends, and keeps their order', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });
    const recorded = recordEvents(ctx.services.bus, threadId);
    try {
      const botId = (await ctx.services.repos.threads.get(threadId))!.botId;
      const first = await ctx.services.harness.startBotRun({ botId, threadId, input: 'first' });
      const second = await ctx.services.harness.startBotRun({ botId, threadId, input: 'second' });
      await waitUntil(() => (gate.started.includes('first') ? true : undefined));

      // The queued run is recorded as running, and announced, but its engine has not been called.
      expect(await ctx.services.repos.runs.get(second.runId)).toMatchObject({ status: 'running' });
      expect(recorded.list).toContainEqual(expect.objectContaining({ type: 'run.started', runId: second.runId }));
      expect(gate.started).toEqual(['first']);

      gate.release('first');
      await waitUntil(() => (gate.started.includes('second') ? true : undefined));
      gate.release('second');
      const outcomes = await Promise.all([first.settled, second.settled]);

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['completed', 'completed']);
      expect(gate.started).toEqual(['first', 'second']);
      expect(gate.engine.contexts[1]?.history.map((message) => message.content)).toContain('answer to first');
      const completed = recorded.list
        .filter((event): event is Extract<CanonicalEvent, { type: 'run.completed' }> => event.type === 'run.completed')
        .map((event) => event.runId);
      expect(completed).toEqual([first.runId, second.runId]);
    } finally {
      recorded.stop();
    }
  });

  it('runs one bot in two threads at the same time', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    const other = await ctx.services.repos.threads.create(bot.id);

    const here = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'here' });
    const there = await ctx.services.harness.startBotRun({ botId: bot.id, threadId: other.id, input: 'there' });
    await waitUntil(() => (gate.started.length === 2 ? true : undefined));

    gate.release('here');
    gate.release('there');
    expect((await Promise.all([here.settled, there.settled])).map((outcome) => outcome.status)).toEqual([
      'completed',
      'completed',
    ]);
  });

  it('runs two bots in one thread at the same time', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { threadId } = await botAndThread(ctx, { computer: 'none' });
    const other = await ctx.services.repos.bots.create({
      name: 'Bea',
      job: 'Testing',
      engine: 'dsh',
      computer: 'none',
      model: 'fake/model-1',
    });

    const adaId = (await ctx.services.repos.threads.get(threadId))!.botId;
    const ada = await ctx.services.harness.startBotRun({ botId: adaId, threadId, input: 'ada' });
    const bea = await ctx.services.harness.startBotRun({ botId: other.id, threadId, input: 'bea' });
    await waitUntil(() => (gate.started.length === 2 ? true : undefined));

    gate.release('ada');
    // Bea answers a message that its DM labels with the author, so the gate is keyed by that label.
    gate.release('[User]: bea');
    expect((await Promise.all([ada.settled, bea.settled])).map((outcome) => outcome.status)).toEqual(['completed', 'completed']);
  });

  it('cancels a queued run without touching the run that holds the bot', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    const first = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'first' });
    const second = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'second' });
    await waitUntil(() => (gate.started.includes('first') ? true : undefined));

    const cancelled = await ctx.services.harness.cancelRun(second.runId);

    expect(cancelled).toMatchObject({ id: second.runId, status: 'cancelled' });
    expect((await second.settled).status).toBe('cancelled');
    expect(gate.engine.contexts[0]?.signal.aborted).toBe(false);

    gate.release('first');
    expect((await first.settled).status).toBe('completed');
    expect(gate.started).toEqual(['first']);
  });

  it('starts the next run only after the engine has returned from the cancelled one', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    const first = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'first' });
    const second = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'second' });
    await waitUntil(() => (gate.started.includes('first') ? true : undefined));

    await ctx.services.harness.cancelRun(first.runId);
    expect((await first.settled).status).toBe('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gate.started).toEqual(['first']);

    gate.release('first');
    await waitUntil(() => (gate.started.includes('second') ? true : undefined));
    gate.release('second');
    expect((await second.settled).status).toBe('completed');
  });

  it('lets the next queued run start when the run before it fails', async () => {
    const holds = new Map<string, () => void>();
    const engine = fakeEngine(async function* (ctx) {
      if (ctx.input === 'boom') {
        await new Promise<void>((resolve) => holds.set('boom', resolve));
        throw new Error('model down');
      }
      yield { type: 'text.delta', delta: 'fine' };
    });
    const ctx = await contextWith({ engines: createEngineRegistry([engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    const failing = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'boom' });
    const after = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'after' });
    await waitUntil(() => holds.get('boom'));
    holds.get('boom')?.();

    expect(await failing.settled).toMatchObject({ status: 'failed', error: 'model down' });
    expect((await after.settled).status).toBe('completed');
  });

  it('refuses a run that may not wait while the bot is busy in the thread, and stores nothing for it', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    const first = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'first' });
    await waitUntil(() => (gate.started.includes('first') ? true : undefined));

    await expect(
      ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'ask', queue: false }),
    ).rejects.toThrow(/already working in this thread/);
    expect((await ctx.services.repos.messages.listByThread(threadId)).map((message) => message.content)).not.toContain('ask');

    gate.release('first');
    await first.settled;
  });

  it('cancels a bot\'s queued and active runs together when the bot is cancelled', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    const first = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'first' });
    const second = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'second' });
    await waitUntil(() => (gate.started.includes('first') ? true : undefined));

    await ctx.services.harness.cancelBotRuns(bot.id);

    expect((await first.settled).status).toBe('cancelled');
    expect((await second.settled).status).toBe('cancelled');
    gate.release('first');
    await first.settled;
    expect(gate.started).toEqual(['first']);
  });

  it('ends queued runs at shutdown without starting them', async () => {
    const gate = gatedEngine();
    const ctx = await contextWith({ engines: createEngineRegistry([gate.engine.driver]) });
    const { bot, threadId } = await botAndThread(ctx, { computer: 'none' });
    const first = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'first' });
    const second = await ctx.services.harness.startBotRun({ botId: bot.id, threadId, input: 'second' });
    await waitUntil(() => (gate.started.includes('first') ? true : undefined));

    ctx.services.harness.shutdown();

    expect((await second.settled).status).toBe('cancelled');
    gate.release('first');
    await first.settled;
    expect(gate.started).toEqual(['first']);
  });
});
