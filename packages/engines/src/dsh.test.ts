import { fileURLToPath } from 'node:url';
import type { EngineEvent } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { createDshEngine, type DshCommand, type DshEngine, type DshEngineOptions } from './dsh';
import { collect, makeContext } from './test-utils';

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

function echoOf(events: EngineEvent[]): { session: string; pid: string; model: string; prompt: string } {
  const match = /session=(\S+) pid=(\d+) model=(\S+) prompt=(\w+)/.exec(textOf(events));
  if (match === null) throw new Error(`no echo in ${JSON.stringify(textOf(events))}`);
  const [, session = '', pid = '', model = '', prompt = ''] = match;
  return { session, pid, model, prompt };
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
});

describe('dsh engine runs', () => {
  it('streams agent text as deltas without tool events', async () => {
    const { ctx, requests } = makeContext({ input: 'stream alpha beta gamma' });
    const events = await collect(engineFor().run(ctx));

    expect(events).toEqual([
      { type: 'text.delta', delta: 'alpha ' },
      { type: 'text.delta', delta: 'beta ' },
      { type: 'text.delta', delta: 'gamma ' },
    ]);
    expect(requests).toEqual([]);
  });

  it('reports the usage the prompt response carries', async () => {
    const { ctx } = makeContext({ input: 'usage now' });
    const events = await collect(engineFor().run(ctx));

    expect(events).toEqual([
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

    expect(events).toEqual([{ type: 'text.delta', delta: 'after malformed' }]);
  });

  it('refuses a second run on a thread that is still busy', async () => {
    const engine = engineFor();
    const controller = new AbortController();
    const first = engine.run(makeContext({ input: 'hang now', signal: controller.signal }).ctx)[Symbol.asyncIterator]();
    expect(await first.next()).toEqual({ done: false, value: { type: 'text.delta', delta: 'partial ' } });

    const second = engine.run(makeContext({ input: 'echo again' }).ctx)[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toThrow('already has a run in progress');

    controller.abort();
    expect((await first.next()).done).toBe(true);
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
    expect(events).toEqual([
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

    expect(events).toEqual([
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
      controller.abort();
    }
    expect(events).toEqual([{ type: 'text.delta', delta: 'partial ' }]);

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
      controller.abort();
    }
    expect(events).toEqual([{ type: 'text.delta', delta: 'stuck ' }]);

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
    expect(events).toEqual([{ type: 'text.delta', delta: 'before crash ' }]);
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
