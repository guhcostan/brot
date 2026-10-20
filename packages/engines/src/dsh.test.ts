import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import type {
  ComputerHandle,
  ComputerProcess,
  EngineEvent,
  LlmRoute,
  McpServerSpec,
  RunContext,
} from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDshEngine,
  DSH_MODEL_HOSTS,
  NO_TOOL_ROWS,
  NO_TOOLS_PATCH,
  pinnedDshCommand,
  type DshCommand,
  type DshEngine,
  type DshEngineOptions,
} from './dsh';
import { DIRECT_PROVIDER_ROWS, llmOverlay } from './dsh-llm';
import { collect, makeContext, type TestContextOptions } from './test-utils';

const FAKE_AGENT = fileURLToPath(new URL('./test-fixtures/fake-acp-agent.mjs', import.meta.url));
const FAKE_COMMAND: DshCommand = { file: process.execPath, args: [FAKE_AGENT] };
const PINNED_VERSION = '0.2.1-rc.2';

const engines: DshEngine[] = [];

function engineFor(opts: DshEngineOptions = {}): DshEngine {
  const engine = createDshEngine({ command: FAKE_COMMAND, cancelGraceMs: 200, ...opts });
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()));
});

function textOf(events: EngineEvent[]): string {
  return events.map((event) => (event.type === 'text.delta' ? event.delta : '')).join('');
}

/** Everything a run reports except the engine session, which tests check on its own. */
function turn(events: EngineEvent[]): EngineEvent[] {
  return events.filter((event) => event.type !== 'engine.session');
}

function sessionOf(events: EngineEvent[]): string | undefined {
  const event = events.find((item) => item.type === 'engine.session');
  return event?.type === 'engine.session' ? event.sessionId : undefined;
}

function echoOf(events: EngineEvent[]): { session: string; pid: string; model: string; prompt: string } {
  const match = /session=(\S+) pid=(\d+) model=(\S+) prompt=(\w+)/.exec(textOf(events));
  if (match === null) throw new Error(`no echo in ${JSON.stringify(textOf(events))}`);
  const [, session = '', pid = '', model = '', prompt = ''] = match;
  return { session, pid, model, prompt };
}

/** Parses `mcp=<json> pid=<pid> session=<id>` from the fake agent's mcp scenario. */
function mcpOf(events: EngineEvent[]): { servers: unknown; pid: string; session: string } {
  const match = /mcp=(.*?) pid=(\d+) session=(\S+)/.exec(textOf(events));
  if (match === null) throw new Error(`no mcp report in ${JSON.stringify(textOf(events))}`);
  const [, json = 'null', pid = '', session = ''] = match;
  return { servers: JSON.parse(json) as unknown, pid, session };
}

const HTTP_SPEC: McpServerSpec = {
  name: 'brot',
  url: 'http://127.0.0.1:8799/mcp',
  headers: { authorization: 'Bearer run-token' },
};
const STDIO_SPEC: McpServerSpec = {
  name: 'docs',
  command: 'node',
  args: ['docs.js'],
  env: { DOCS_HOME: '/data' },
};

interface FakeComputer {
  handle: ComputerHandle;
  execs: Array<{ cmd: string[]; env?: Record<string, string> }>;
  kills: string[];
}

/**
 * A computer whose `dsh` is the fake ACP agent and whose `sh` is the real shell, each started as a local
 * process so the stdio is real.
 */
function fakeComputer(): FakeComputer {
  const execs: FakeComputer['execs'] = [];
  const kills: string[] = [];
  const handle: ComputerHandle = {
    id: 'computer_test',
    async exec(cmd, opts) {
      execs.push({ cmd, env: opts?.env });
      const [file, ...args] = cmd;
      if (file !== 'dsh' && file !== 'sh') throw new Error(`unexpected program ${file ?? ''}`);
      const child =
        file === 'dsh'
          ? spawn(process.execPath, [FAKE_AGENT, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
          : spawn('sh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const proc: ComputerProcess = {
        stdin: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        stdout: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
        stderr: Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>,
        exit: new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
        kill(signal) {
          kills.push(signal ?? 'SIGTERM');
          child.kill(signal);
        },
      };
      return proc;
    },
  };
  return { handle, execs, kills };
}

/** Row states of a `dsh --dump-config` tree. A row is disabled when its last block says so. */
function rowStates(dump: string): Map<string, 'enabled' | 'disabled'> {
  const states = new Map<string, 'enabled' | 'disabled'>();
  let id: string | undefined;
  let disabled = false;
  const finish = (): void => {
    if (id !== undefined) states.set(id, disabled ? 'disabled' : 'enabled');
    id = undefined;
    disabled = false;
  };
  for (const line of dump.split('\n')) {
    if (line.startsWith('- id: ')) {
      finish();
      id = line.slice('- id: '.length).trim();
    } else if (line.startsWith('# ==')) {
      finish();
    } else if (line === '  disabled: true') {
      disabled = true;
    }
  }
  finish();
  return states;
}

describe('dsh engine detection', () => {
  it('reports the version the launcher prints', async () => {
    expect(await engineFor().detect()).toEqual({ available: true, version: PINNED_VERSION });
  });

  it('reports unavailable when the launcher cannot answer --version', async () => {
    const result = await engineFor({ command: { file: '/nonexistent/dsh' } }).detect();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('did not answer --version');
  });

  it('runs the pinned DeepSeek Harness launcher by default', async () => {
    expect(await createDshEngine().detect()).toEqual({ available: true, version: PINNED_VERSION });
  });

  it('allows only the DeepSeek API host for the default model route', () => {
    expect(DSH_MODEL_HOSTS).toEqual(['api.deepseek.com']);
  });
});

describe('dsh engine runs', () => {
  it('streams agent text as deltas without tool events', async () => {
    const { ctx, requests } = makeContext({ input: 'stream alpha beta gamma' });
    const events = await collect(engineFor().run(ctx));

    expect(turn(events)).toEqual([
      { type: 'text.delta', delta: 'alpha ' },
      { type: 'text.delta', delta: 'beta ' },
      { type: 'text.delta', delta: 'gamma ' },
    ]);
    expect(requests).toEqual([]);
  });

  it('reports the usage the prompt response carries', async () => {
    const { ctx } = makeContext({ input: 'usage now' });
    const events = await collect(engineFor().run(ctx));

    expect(turn(events)).toEqual([
      { type: 'text.delta', delta: 'counted' },
      { type: 'usage', tokensIn: 12, tokensOut: 34, costUsd: 0 },
    ]);
  });

  it('sends the full prompt on a thread first turn, then only the new input', async () => {
    const engine = engineFor();
    const first = await collect(engine.run(makeContext({ input: 'echo one', bot: { instructions: 'Be brief' } }).ctx));
    const second = await collect(engine.run(makeContext({ input: 'echo two' }).ctx));

    expect(echoOf(first).prompt).toBe('full');
    expect(echoOf(second).prompt).toBe('input');
    expect(echoOf(second).session).toBe(echoOf(first).session);
    expect(echoOf(second).pid).toBe(echoOf(first).pid);
  });

  it('runs each Brot thread in its own server process and DSH session', async () => {
    const engine = engineFor();
    const one = await collect(engine.run(makeContext({ input: 'echo a' }).ctx));
    const other = { ...makeContext({ input: 'echo b' }).ctx, threadId: 'thread_2' };
    const two = await collect(engine.run(other));

    expect(echoOf(two).pid).not.toBe(echoOf(one).pid);
    expect(echoOf(two).session).not.toBe(echoOf(one).session);
  });

  it('selects the bot model through the ACP model option', async () => {
    const engine = engineFor();
    const events = await collect(engine.run(makeContext({ input: 'echo hi', bot: { model: 'fake/beta' } }).ctx));

    expect(echoOf(events).model).toBe('["fake","beta"]');
    expect(await engine.models()).toEqual([
      { id: 'default', label: 'Default' },
      { id: 'fake/alpha', label: 'Fake: alpha' },
      { id: 'fake/beta', label: 'Fake: beta' },
    ]);
  });

  it('fails a run whose bot model the agent does not offer', async () => {
    const { ctx } = makeContext({ input: 'echo hi', bot: { model: 'fake/gamma' } });
    await expect(collect(engineFor().run(ctx))).rejects.toThrow('does not offer model fake/gamma');
  });

  it('lists only the default model before any session exists', async () => {
    expect(await engineFor().models()).toEqual([{ id: 'default', label: 'Default' }]);
  });

  it('surfaces an agent error as a run failure', async () => {
    const { ctx } = makeContext({ input: 'error now' });
    await expect(collect(engineFor().run(ctx))).rejects.toThrow('DeepSeek Harness run failed: model unavailable');
  });

  it('ignores stdout lines that are not JSON objects', async () => {
    const { ctx } = makeContext({ input: 'malformed now' });
    const events = await collect(engineFor().run(ctx));

    expect(turn(events)).toEqual([{ type: 'text.delta', delta: 'after malformed' }]);
  });

  it('refuses a second run on a thread that is still busy', async () => {
    const engine = engineFor();
    const controller = new AbortController();
    const first = engine.run(makeContext({ input: 'hang now', signal: controller.signal }).ctx)[Symbol.asyncIterator]();
    expect(await first.next()).toEqual({ done: false, value: { type: 'engine.session', sessionId: expect.any(String) } });
    expect(await first.next()).toEqual({ done: false, value: { type: 'text.delta', delta: 'partial ' } });

    const second = engine.run(makeContext({ input: 'echo again' }).ctx)[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toThrow('already has a run in progress');

    controller.abort();
    expect((await first.next()).done).toBe(true);
  });
});

describe('dsh engine sessions', () => {
  it('reminds a resumed room session which bot it is, and leaves a direct thread input alone', async () => {
    const engine = engineFor();
    const room = {
      title: 'Team',
      responder: 'lead' as const,
      members: [{ id: 'bot_1', name: 'Test bot', job: 'Testing' }],
    };
    const first = await collect(engine.run(makeContext({ input: 'echo one', room }).ctx));
    const second = await collect(engine.run(makeContext({ input: 'echo two', room }).ctx));
    const direct = await collect(engine.run(makeContext({ input: 'echo three' }).ctx));

    expect(echoOf(first).prompt).toBe('full');
    expect(textOf(second)).toMatch(/prompt=input reminder=yes/);
    expect(textOf(direct)).toMatch(/prompt=input reminder=no/);
  });

  it('reports the engine session it creates, once, before the prompt runs', async () => {
    const events = await collect(engineFor().run(makeContext({ input: 'echo one' }).ctx));

    expect(events[0]).toEqual({ type: 'engine.session', sessionId: echoOf(events).session });
    expect(events.filter((event) => event.type === 'engine.session')).toHaveLength(1);
  });

  it('resumes the engine session by id in a new process and sends only the new input', async () => {
    const first = await collect(engineFor().run(makeContext({ input: 'echo one' }).ctx));
    const sessionId = sessionOf(first);

    const resumed = await collect(
      engineFor().run(makeContext({ input: 'echo two', engineSessionId: sessionId }).ctx),
    );

    expect(sessionOf(resumed)).toBeUndefined();
    expect(echoOf(resumed).session).toBe(sessionId);
    expect(echoOf(resumed).prompt).toBe('input');
    expect(echoOf(resumed).pid).not.toBe(echoOf(first).pid);
  });

  it('keeps an open session without re-emitting it when the id matches', async () => {
    const engine = engineFor();
    const first = await collect(engine.run(makeContext({ input: 'echo one' }).ctx));
    const sessionId = sessionOf(first);

    const second = await collect(engine.run(makeContext({ input: 'echo two', engineSessionId: sessionId }).ctx));

    expect(sessionOf(second)).toBeUndefined();
    expect(echoOf(second).pid).toBe(echoOf(first).pid);
  });

  it('re-reports the open session when the caller does not know its id', async () => {
    const engine = engineFor();
    const first = await collect(engine.run(makeContext({ input: 'echo one' }).ctx));
    const second = await collect(engine.run(makeContext({ input: 'echo two' }).ctx));

    expect(sessionOf(second)).toBe(sessionOf(first));
  });

  it('attaches the run MCP servers in ACP form', async () => {
    const { ctx } = makeContext({ input: 'mcp now', mcpServers: [HTTP_SPEC, STDIO_SPEC] });
    const events = await collect(engineFor().run(ctx));

    expect(mcpOf(events).servers).toEqual([
      {
        type: 'http',
        name: 'brot',
        url: 'http://127.0.0.1:8799/mcp',
        headers: [{ name: 'authorization', value: 'Bearer run-token' }],
      },
      { name: 'docs', command: 'node', args: ['docs.js'], env: [{ name: 'DOCS_HOME', value: '/data' }] },
    ]);
  });

  it('re-attaches MCP servers on the same session when a later run brings different ones', async () => {
    const engine = engineFor();
    const first = await collect(engine.run(makeContext({ input: 'mcp now', mcpServers: [HTTP_SPEC] }).ctx));
    const second = await collect(
      engine.run(
        makeContext({ input: 'mcp now', engineSessionId: sessionOf(first), mcpServers: [STDIO_SPEC] }).ctx,
      ),
    );

    expect(mcpOf(second).servers).toEqual([
      { name: 'docs', command: 'node', args: ['docs.js'], env: [{ name: 'DOCS_HOME', value: '/data' }] },
    ]);
    expect(mcpOf(second).session).toBe(mcpOf(first).session);
    expect(mcpOf(second).pid).toBe(mcpOf(first).pid);
    expect(sessionOf(second)).toBeUndefined();
  });
});

/** A run by one bot in a thread (default `thread_1`), the way a room hands runs to the engine. */
function botRun(botId: string, input: string, opts: Omit<TestContextOptions, 'input' | 'bot'> = {}): RunContext {
  return makeContext({ ...opts, input, bot: { id: botId } }).ctx;
}

function alive(pid: string): boolean {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

const HTTP_ACP = {
  type: 'http',
  name: 'brot',
  url: 'http://127.0.0.1:8799/mcp',
  headers: [{ name: 'authorization', value: 'Bearer run-token' }],
};
const STDIO_ACP = { name: 'docs', command: 'node', args: ['docs.js'], env: [{ name: 'DOCS_HOME', value: '/data' }] };

describe('dsh engine bots in one thread', () => {
  it('gives each bot its own server process and DSH session', async () => {
    const engine = engineFor();
    const first = await collect(engine.run(botRun('bot_a', 'echo a1')));
    const second = await collect(engine.run(botRun('bot_b', 'echo b1')));
    const firstAgain = echoOf(await collect(engine.run(botRun('bot_a', 'echo a2'))));

    expect(sessionOf(second)).toBe(echoOf(second).session);
    expect(echoOf(second).session).not.toBe(echoOf(first).session);
    expect(echoOf(second).pid).not.toBe(echoOf(first).pid);
    expect(echoOf(second).prompt).toBe('full');
    expect(firstAgain).toMatchObject({ session: echoOf(first).session, pid: echoOf(first).pid, prompt: 'input' });
  });

  it('resumes each bot by its own engine session id, in its process and after close', async () => {
    const engine = engineFor();
    const first = echoOf(await collect(engine.run(botRun('bot_a', 'echo a1'))));
    const other = echoOf(await collect(engine.run(botRun('bot_b', 'echo b1'))));
    expect(other.session).not.toBe(first.session);

    const resumed = echoOf(await collect(engine.run(botRun('bot_a', 'echo a2', { engineSessionId: first.session }))));
    expect(resumed).toMatchObject({ session: first.session, pid: first.pid, prompt: 'input' });

    await engine.close();
    const restarted = await collect(engine.run(botRun('bot_b', 'echo b2', { engineSessionId: other.session })));
    expect(sessionOf(restarted)).toBeUndefined();
    expect(echoOf(restarted)).toMatchObject({ session: other.session, prompt: 'input' });
    expect(echoOf(restarted).pid).not.toBe(other.pid);

    const unnamed = echoOf(await collect(engine.run(botRun('bot_a', 'echo a3'))));
    expect(unnamed.session).toBe(first.session);
  });

  it('keeps each bot on its own placement, so a bot with a computer never restarts another bot', async () => {
    const computer = fakeComputer();
    const engine = engineFor();
    const local = echoOf(await collect(engine.run(botRun('bot_a', 'echo local'))));
    const contained = echoOf(await collect(engine.run(botRun('bot_b', 'echo inside', { computer: computer.handle }))));
    const localAgain = echoOf(await collect(engine.run(botRun('bot_a', 'echo local again'))));
    const containedAgain = echoOf(
      await collect(engine.run(botRun('bot_b', 'echo inside again', { computer: computer.handle }))),
    );

    expect(contained.pid).not.toBe(local.pid);
    expect(localAgain).toMatchObject({ pid: local.pid, session: local.session });
    expect(containedAgain).toMatchObject({ pid: contained.pid, session: contained.session });
    expect(computer.execs).toHaveLength(1);
    expect(computer.kills).toEqual([]);
  });

  it('re-attaches MCP servers only to the bot whose spec changed', async () => {
    const engine = engineFor();
    const a = await collect(engine.run(botRun('bot_a', 'mcp a1', { mcpServers: [HTTP_SPEC] })));
    const b = await collect(engine.run(botRun('bot_b', 'mcp b1', { mcpServers: [HTTP_SPEC] })));
    const bAgain = await collect(
      engine.run(botRun('bot_b', 'mcp b2', { engineSessionId: sessionOf(b), mcpServers: [HTTP_SPEC] })),
    );
    const aChanged = await collect(
      engine.run(botRun('bot_a', 'mcp a2', { engineSessionId: sessionOf(a), mcpServers: [STDIO_SPEC] })),
    );

    expect(sessionOf(bAgain)).toBeUndefined();
    expect(mcpOf(bAgain)).toEqual({ servers: [HTTP_ACP], pid: mcpOf(b).pid, session: mcpOf(b).session });
    expect(mcpOf(aChanged)).toEqual({ servers: [STDIO_ACP], pid: mcpOf(a).pid, session: mcpOf(a).session });
    expect(mcpOf(b).pid).not.toBe(mcpOf(a).pid);
  });

  it('cancels one bot without touching another bot running in the same thread', async () => {
    const engine = engineFor();
    const controller = new AbortController();
    const hanging = engine.run(botRun('bot_a', 'hang now', { signal: controller.signal }))[Symbol.asyncIterator]();
    expect(await hanging.next()).toEqual({
      done: false,
      value: { type: 'engine.session', sessionId: expect.any(String) },
    });
    expect(await hanging.next()).toEqual({ done: false, value: { type: 'text.delta', delta: 'partial ' } });

    const other = echoOf(await collect(engine.run(botRun('bot_b', 'echo b1'))));
    controller.abort();
    expect((await hanging.next()).done).toBe(true);

    const otherAfter = echoOf(await collect(engine.run(botRun('bot_b', 'echo b2'))));
    expect(otherAfter).toMatchObject({ pid: other.pid, session: other.session, prompt: 'input' });
    expect(echoOf(await collect(engine.run(botRun('bot_a', 'echo a2')))).prompt).toBe('input');
  });

  it('kills only the stuck process of a bot that ignores cancel', async () => {
    const engine = engineFor({ cancelGraceMs: 100 });
    const other = echoOf(await collect(engine.run(botRun('bot_b', 'echo b1'))));
    const stuckBefore = echoOf(await collect(engine.run(botRun('bot_a', 'echo a1'))));

    const controller = new AbortController();
    const events: EngineEvent[] = [];
    for await (const event of engine.run(botRun('bot_a', 'ignore-cancel now', { signal: controller.signal }))) {
      events.push(event);
      if (event.type === 'text.delta') controller.abort();
    }
    expect(turn(events)).toEqual([{ type: 'text.delta', delta: 'stuck ' }]);
    expect(alive(stuckBefore.pid)).toBe(false);
    expect(alive(other.pid)).toBe(true);

    const otherAfter = echoOf(await collect(engine.run(botRun('bot_b', 'echo b2'))));
    expect(otherAfter.pid).toBe(other.pid);
    const stuckAfter = echoOf(await collect(engine.run(botRun('bot_a', 'echo a2'))));
    expect(stuckAfter).toMatchObject({ session: stuckBefore.session, prompt: 'input' });
    expect(stuckAfter.pid).not.toBe(stuckBefore.pid);
  });

  it('close stops the process of every bot in every thread, computer ones included', async () => {
    const computer = fakeComputer();
    const engine = engineFor();
    const a = echoOf(await collect(engine.run(botRun('bot_a', 'echo a1'))));
    const b = echoOf(await collect(engine.run(botRun('bot_b', 'echo b1'))));
    const otherThread = echoOf(await collect(engine.run(botRun('bot_a', 'echo a1', { threadId: 'thread_2' }))));
    await collect(engine.run(botRun('bot_c', 'echo c1', { computer: computer.handle })));

    expect(new Set([a.pid, b.pid, otherThread.pid]).size).toBe(3);
    expect([a.pid, b.pid, otherThread.pid].every((pid) => alive(pid))).toBe(true);

    await engine.close();

    expect([a.pid, b.pid, otherThread.pid].some(alive)).toBe(false);
    expect(computer.kills).toEqual(['SIGTERM']);
  });
});

describe('dsh engine computers', () => {
  it('starts DSH inside the computer with exec and never spawns it locally', async () => {
    const computer = fakeComputer();
    const engine = engineFor({ command: { file: '/nonexistent/dsh' } });
    const events = await collect(engine.run(makeContext({ input: 'echo inside', computer: computer.handle }).ctx));

    expect(computer.execs).toEqual([{ cmd: ['dsh', '--profile', 'acp'], env: { DSH_TELEMETRY_DISABLED: '1' } }]);
    expect(echoOf(events).prompt).toBe('full');
    expect(sessionOf(events)).toBe(echoOf(events).session);
  });

  it('forwards only the configured computer environment, never the host environment', async () => {
    const computer = fakeComputer();
    const engine = engineFor({ computerEnv: { DEEPSEEK_API_KEY: 'provisioned' } });
    await collect(engine.run(makeContext({ input: 'echo env', computer: computer.handle }).ctx));

    expect(computer.execs[0]?.env).toEqual({ DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'provisioned' });
  });

  it('surfaces a failed computer exec as a run failure', async () => {
    const handle: ComputerHandle = {
      id: 'computer_down',
      exec: () => Promise.reject(new Error('container not running')),
    };
    const { ctx } = makeContext({ input: 'echo down', computer: handle });
    await expect(collect(engineFor().run(ctx))).rejects.toThrow(
      'DeepSeek Harness run failed: container not running',
    );
  });

  it('kills the computer process on close and resumes its session in the next computer', async () => {
    const computer = fakeComputer();
    const engine = engineFor();
    const first = await collect(engine.run(makeContext({ input: 'echo one', computer: computer.handle }).ctx));
    await engine.close();

    expect(computer.kills).toEqual(['SIGTERM']);
    const second = await collect(
      engine.run(
        makeContext({ input: 'echo two', computer: computer.handle, engineSessionId: sessionOf(first) }).ctx,
      ),
    );
    expect(echoOf(second).session).toBe(sessionOf(first));
    expect(computer.execs).toHaveLength(2);
  });

  it('never reuses a local no-tools process for a run that has a computer', async () => {
    const computer = fakeComputer();
    const engine = engineFor();
    const local = await collect(engine.run(makeContext({ input: 'echo local' }).ctx));
    const contained = await collect(
      engine.run(makeContext({ input: 'echo contained', computer: computer.handle, engineSessionId: sessionOf(local) }).ctx),
    );

    expect(computer.execs).toHaveLength(1);
    expect(echoOf(contained).pid).not.toBe(echoOf(local).pid);
  });
});

describe('dsh engine without a computer', () => {
  it('launches DSH locally with the no-tools overlay and passes its path with --patch', async () => {
    const events = await collect(engineFor().run(makeContext({ input: 'argv now' }).ctx));
    const args = JSON.parse(/argv=(.*)/.exec(textOf(events))?.[1] ?? 'null') as string[];
    const patchPath = args[args.indexOf('--patch') + 1] ?? '';

    expect(args.slice(0, 3)).toEqual(['--profile', 'acp', '--patch']);
    expect(readFileSync(patchPath, 'utf8')).toBe(NO_TOOLS_PATCH);
  });

  it('writes an overlay that disables every shell, filesystem, web and subagent row', () => {
    for (const id of NO_TOOL_ROWS) {
      expect(NO_TOOLS_PATCH).toContain(`- id: ${id}\n  disabled: true\n`);
    }
    expect(NO_TOOL_ROWS).toContain('tool-bash');
    expect(NO_TOOL_ROWS).toContain('tool-web');
  });

  it('disables those rows in the pinned DeepSeek profile', () => {
    const launcher = pinnedDshCommand();
    if (launcher === undefined) return;
    const home = mkdtempSync(join(tmpdir(), 'brot-dsh-profile-'));
    try {
      const patch = join(home, 'no-tools.patch.yml');
      writeFileSync(patch, NO_TOOLS_PATCH);
      const dump = execFileSync(
        launcher.file,
        [...(launcher.args ?? []), '--profile', 'acp', '--patch', patch, '--dump-config'],
        {
          encoding: 'utf8',
          timeout: 60_000,
          env: { ...process.env, DSH_HOME: join(home, 'dsh'), DSH_TELEMETRY_DISABLED: '1' },
        },
      );
      const states = rowStates(dump);
      for (const id of NO_TOOL_ROWS) expect(states.get(id), id).toBe('disabled');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/** A relay route for the fake agent, whose catalog holds `fake/alpha` and `fake/beta`. */
function routeFor(token: string, model = 'beta'): LlmRoute {
  return {
    provider: 'fake',
    model,
    api: 'openai-completions',
    baseUrl: 'http://brot-relay.test/llm/runs/run_1/v1',
    token,
  };
}

/** The route of the pinned DeepSeek profile, which lists the model in its own catalog. */
const PINNED_ROUTE: LlmRoute = {
  provider: 'opencode-go',
  model: 'deepseek-v4.1-flash',
  api: 'openai-completions',
  baseUrl: 'http://brot-relay.test/llm/runs/run_1/v1',
  token: 'relay-token-pinned',
};

function argvOf(events: EngineEvent[]): string[] {
  return JSON.parse(/argv=(.*)/.exec(textOf(events))?.[1] ?? 'null') as string[];
}

/** Parses `token=<token> pid=<pid> session=<id>` from the fake agent's env scenario. */
function envOf(events: EngineEvent[]): { token: string; pid: string; session: string } {
  const match = /token=(\S+) pid=(\d+) session=(\S+)/.exec(textOf(events));
  if (match === null) throw new Error(`no env report in ${JSON.stringify(textOf(events))}`);
  const [, token = '', pid = '', session = ''] = match;
  return { token, pid, session };
}

/** The trimmed lines one `--patch` overlay contributed to a `dsh --dump-config` tree, in every layer. */
function overlayLines(dump: string, overlay: string): string[] {
  const lines: string[] = [];
  let inOverlay = false;
  for (const line of dump.split('\n')) {
    if (line.startsWith('# ==')) {
      inOverlay = line.endsWith(overlay);
      continue;
    }
    if (inOverlay) lines.push(line.trim());
  }
  return lines;
}

describe('dsh engine with a relay route', () => {
  it('runs locally with the no-tools overlay and the route overlay, and the run token in its env', async () => {
    const engine = engineFor();
    const { ctx } = makeContext({ input: 'argv now', llm: routeFor('token-a') });
    const args = argvOf(await collect(engine.run(ctx)));
    const routePatch = args[args.lastIndexOf('--patch') + 1] ?? '';

    expect(args.slice(0, 6).filter((arg) => arg === '--patch')).toHaveLength(2);
    expect(readFileSync(routePatch, 'utf8')).toBe(llmOverlay(routeFor('token-a')));
    const env = await collect(engine.run(makeContext({ input: 'env now', llm: routeFor('token-a') }).ctx));
    expect(envOf(env)).toMatchObject({ token: 'token-a' });
  });

  it('sends the run through the route model whatever model the bot names', async () => {
    const engine = engineFor();
    const events = await collect(
      engine.run(makeContext({ input: 'echo hi', bot: { model: 'fake/alpha' }, llm: routeFor('token-a') }).ctx),
    );

    expect(echoOf(events).model).toBe('["fake","beta"]');
  });

  it('fails a routed run whose route model the agent does not offer', async () => {
    const { ctx } = makeContext({ input: 'echo hi', llm: routeFor('token-a', 'gamma') });
    await expect(collect(engineFor().run(ctx))).rejects.toThrow('does not offer model fake/gamma');
  });

  it('restarts the process when the run token changes and resumes the session by id', async () => {
    const engine = engineFor();
    const first = await collect(engine.run(makeContext({ input: 'env one', llm: routeFor('token-a') }).ctx));
    const sessionId = sessionOf(first);

    const second = await collect(
      engine.run(makeContext({ input: 'env two', engineSessionId: sessionId, llm: routeFor('token-b') }).ctx),
    );
    expect(sessionOf(second)).toBeUndefined();
    expect(envOf(second)).toMatchObject({ token: 'token-b', session: sessionId });
    expect(envOf(second).pid).not.toBe(envOf(first).pid);

    const third = await collect(
      engine.run(makeContext({ input: 'env three', engineSessionId: sessionId, llm: routeFor('token-b') }).ctx),
    );
    expect(envOf(third)).toMatchObject({ token: 'token-b', pid: envOf(second).pid, session: sessionId });
  });

  it('restarts without the token when a later run has no route, and keeps the session', async () => {
    const engine = engineFor();
    const routed = await collect(engine.run(makeContext({ input: 'env one', llm: routeFor('token-a') }).ctx));
    const sessionId = sessionOf(routed);

    const plain = await collect(engine.run(makeContext({ input: 'env two', engineSessionId: sessionId }).ctx));
    expect(envOf(plain)).toMatchObject({ token: 'none', session: sessionId });
    expect(envOf(plain).pid).not.toBe(envOf(routed).pid);
  });

  it('starts a routed computer run by writing the overlay into the computer and passing the token', async () => {
    const computer = fakeComputer();
    const events = await collect(
      engineFor().run(makeContext({ input: 'argv inside', computer: computer.handle, llm: routeFor('token-a') }).ctx),
    );
    const [writer, launch] = computer.execs;
    const overlay = argvOf(events).at(-1) ?? '';

    expect(writer?.cmd).toEqual(['sh', '-c', 'umask 077 && cat > "$1"', 'sh', overlay]);
    expect(launch?.cmd).toEqual(['dsh', '--profile', 'acp', '--patch', overlay]);
    expect(launch?.env).toEqual({ DSH_TELEMETRY_DISABLED: '1', BROT_LLM_TOKEN: 'token-a' });
    expect(readFileSync(overlay, 'utf8')).toBe(llmOverlay(routeFor('token-a')));
    rmSync(overlay, { force: true });
  });

  it('makes the pinned DeepSeek profile send model requests to the relay and disables direct provider rows', () => {
    const launcher = pinnedDshCommand();
    if (launcher === undefined) return;
    const home = mkdtempSync(join(tmpdir(), 'brot-dsh-llm-profile-'));
    try {
      const noTools = join(home, 'no-tools.patch.yml');
      const overlay = join(home, 'llm.patch.yml');
      writeFileSync(noTools, NO_TOOLS_PATCH);
      writeFileSync(overlay, llmOverlay(PINNED_ROUTE));
      const dump = execFileSync(
        launcher.file,
        [...(launcher.args ?? []), '--profile', 'acp', '--patch', noTools, '--patch', overlay, '--dump-config'],
        {
          encoding: 'utf8',
          timeout: 60_000,
          env: { ...process.env, DSH_HOME: join(home, 'dsh'), DSH_TELEMETRY_DISABLED: '1' },
        },
      );

      const lines = overlayLines(dump, overlay);
      expect(lines).toEqual(
        expect.arrayContaining([
          '- id: llm-pi-ai',
          'providers:',
          'opencode-go:',
          'api: openai-completions',
          `baseURL: ${PINNED_ROUTE.baseUrl}`,
          'apiKeyEnv: BROT_LLM_TOKEN',
          '- id: deepseek-v4.1-flash',
          'provider: opencode-go',
          'model: deepseek-v4.1-flash',
        ]),
      );
      const states = rowStates(dump);
      expect(states.get('llm-pi-ai')).toBe('enabled');
      for (const id of DIRECT_PROVIDER_ROWS) expect(states.get(id), id).toBe('disabled');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('dsh engine permissions', () => {
  it('answers an allowed tool with allow-once and reports the call and its result', async () => {
    const { ctx, requests } = makeContext({ input: 'tool ls -la', decide: () => ({ allowed: true }) });
    const events = await collect(engineFor().run(ctx));

    expect(requests).toEqual([
      {
        callId: 'call-1',
        tool: 'bash',
        kind: 'shell',
        summary: 'bash: ls -la',
        args: { command: 'ls -la' },
      },
    ]);
    expect(turn(events)).toEqual([
      { type: 'tool.call', callId: 'call-1', tool: 'bash', args: { command: 'ls -la' } },
      { type: 'tool.result', callId: 'call-1', ok: true, output: 'ran ls -la' },
      { type: 'text.delta', delta: 'done' },
    ]);
  });

  it('answers a denied tool with reject-once and passes the user reply on', async () => {
    const { ctx } = makeContext({
      input: 'tool rm -rf build',
      decide: () => ({ allowed: false, reply: 'not today' }),
    });
    const events = await collect(engineFor().run(ctx));

    expect(turn(events)).toEqual([
      { type: 'tool.call', callId: 'call-1', tool: 'bash', args: { command: 'rm -rf build' } },
      { type: 'tool.result', callId: 'call-1', ok: false, output: 'denied by user: not today' },
      { type: 'text.delta', delta: 'permission selected' },
    ]);
  });

  it('denies a tool when the broker fails', async () => {
    const { ctx } = makeContext({
      input: 'tool ls',
      decide: () => {
        throw new Error('broker unavailable');
      },
    });
    const events = await collect(engineFor().run(ctx));

    expect(events).toContainEqual({ type: 'tool.result', callId: 'call-1', ok: false, output: 'denied by user' });
    expect(events.at(-1)).toEqual({ type: 'text.delta', delta: 'permission selected' });
  });
});

describe('dsh engine cancellation and failure', () => {
  it('cancels a run on abort, keeps the server process, and returns without error', async () => {
    const engine = engineFor();
    const controller = new AbortController();
    const events: EngineEvent[] = [];
    for await (const event of engine.run(makeContext({ input: 'hang now', signal: controller.signal }).ctx)) {
      events.push(event);
      if (event.type === 'text.delta') controller.abort();
    }
    expect(turn(events)).toEqual([{ type: 'text.delta', delta: 'partial ' }]);

    const next = await collect(engine.run(makeContext({ input: 'echo after' }).ctx));
    expect(echoOf(next).prompt).toBe('input');
  });

  it('kills a server that ignores cancel and resumes its session on the next run', async () => {
    const engine = engineFor({ cancelGraceMs: 100 });
    const before = echoOf(await collect(engine.run(makeContext({ input: 'echo first' }).ctx)));

    const controller = new AbortController();
    const events: EngineEvent[] = [];
    for await (const event of engine.run(makeContext({ input: 'ignore-cancel now', signal: controller.signal }).ctx)) {
      events.push(event);
      if (event.type === 'text.delta') controller.abort();
    }
    expect(turn(events)).toEqual([{ type: 'text.delta', delta: 'stuck ' }]);

    const after = echoOf(await collect(engine.run(makeContext({ input: 'echo second' }).ctx)));
    expect(after.session).toBe(before.session);
    expect(after.pid).not.toBe(before.pid);
    expect(after.prompt).toBe('input');
  });

  it('fails the run when the server process crashes', async () => {
    const { ctx } = makeContext({ input: 'crash now' });
    const events: EngineEvent[] = [];
    const attempt = (async () => {
      for await (const event of engineFor().run(ctx)) events.push(event);
    })();

    await expect(attempt).rejects.toThrow(/DeepSeek Harness (server exited with code 3|run failed)/);
    expect(turn(events)).toEqual([{ type: 'text.delta', delta: 'before crash ' }]);
  });

  it('resumes the thread session in a new process after close', async () => {
    const engine = engineFor();
    const before = echoOf(await collect(engine.run(makeContext({ input: 'echo one' }).ctx)));

    await engine.close();
    const after = echoOf(await collect(engine.run(makeContext({ input: 'echo two' }).ctx)));

    expect(after.session).toBe(before.session);
    expect(after.pid).not.toBe(before.pid);
    expect(after.prompt).toBe('input');
  });
});
