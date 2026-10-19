import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Approval, Bot } from '@brot/protocol';
import { createEngineRegistry, createMockEngine } from '@brot/engines';
import { startServer, type ServerHandle, type StartOptions } from '@brot/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli, type CliDeps } from './cli';
import { capture } from './testing';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A real server on port 0 with only the mock engine, writing to a temporary home. */
async function withServer(): Promise<{ url: string; home: string; start: (options: StartOptions) => Promise<ServerHandle> }> {
  const home = await mkdtemp(join(tmpdir(), 'brot-cli-e2e-'));
  const start = (options: StartOptions) =>
    startServer({ ...options, home, webhookPort: 0, engines: createEngineRegistry([createMockEngine()]) });
  const server = await start({ host: '127.0.0.1', port: 0 });
  cleanups.push(async () => {
    await server.close();
    await rm(home, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${server.port}`, home, start };
}

function harness(home: string, start: (options: StartOptions) => Promise<ServerHandle>, overrides: Partial<CliDeps> = {}) {
  const stdout = capture();
  const stderr = capture();
  const controller = new AbortController();
  const deps: CliDeps = {
    env: { BROT_HOME: home },
    stdout,
    stderr,
    fetch: globalThis.fetch,
    signal: controller.signal,
    start,
    engines: [createMockEngine()],
    nodeVersion: process.versions.node,
    ...overrides,
  };
  return { deps, stdout, stderr, controller };
}

async function firstBot(url: string): Promise<Bot> {
  const bots = (await (await fetch(`${url}/api/bots`)).json()) as Bot[];
  const [bot] = bots;
  if (!bot) throw new Error('expected the seeded bot');
  return bot;
}

async function waitForApproval(url: string): Promise<Approval> {
  return vi.waitFor(
    async () => {
      const pending = (await (await fetch(`${url}/api/approvals?status=pending`)).json()) as Approval[];
      const [approval] = pending;
      if (!approval) throw new Error('no approval yet');
      return approval;
    },
    { timeout: 5_000, interval: 20 },
  );
}

describe('brot against a real server', () => {
  it('run streams the mock reply as plain text', async () => {
    const { url, home, start } = await withServer();
    const bot = await firstBot(url);
    const { deps, stdout, stderr } = harness(home, start);

    expect(await runCli(['run', bot.id, 'hello', 'there', '--url', url], deps)).toBe(0);
    expect(stdout.text()).toBe('You said: hello there\n');
    expect(stderr.text()).toMatch(/^run \S+ \(Capy, mock\)\n$/);
  });

  it('run --json emits only the run events, one per line', async () => {
    const { url, home, start } = await withServer();
    const bot = await firstBot(url);
    const { deps, stdout } = harness(home, start);

    expect(await runCli(['run', bot.id, 'hi', '--json', '--url', url], deps)).toBe(0);
    const events = stdout
      .text()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; runId: string });
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'message.delta',
      'message.delta',
      'message.delta',
      'cost.updated',
      'message.completed',
      'run.completed',
    ]);
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
  });

  it('holds a tool run until a person decides the approval over the API', async () => {
    const { url, home, start } = await withServer();
    const bot = await firstBot(url);
    const { deps, stdout, stderr } = harness(home, start);

    const running = runCli(['run', bot.id, '/tool shell ls -la', '--url', url], deps);
    const approval = await waitForApproval(url);
    // The server stores the approval before it publishes approval.requested, so the CLI prints it a moment later.
    await vi.waitFor(() => expect(stderr.text()).toContain(`Approval ${approval.id} needed (shell, shell): ls -la`), {
      timeout: 5_000,
      interval: 20,
    });

    let finished = false;
    void running.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(finished).toBe(false);

    const decided = await fetch(`${url}/api/approvals/${approval.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'allow_once' }),
    });
    expect(decided.status).toBe(200);

    expect(await running).toBe(0);
    expect(stderr.text()).toContain(`Approval ${approval.id} allowed.`);
    expect(stderr.text()).toContain('[tool] ok: ok');
    expect(stdout.text()).toBe('');
  });

  it('run fails with exit 1 for a bot the server does not know', async () => {
    const { url, home, start } = await withServer();
    const { deps, stderr } = harness(home, start);

    expect(await runCli(['run', 'bot_missing', 'hi', '--url', url], deps)).toBe(1);
    expect(stderr.text()).toBe(`No bot with id bot_missing on ${url}.\n`);
  });

  it('doctor reports the running server', async () => {
    const { url, home, start } = await withServer();
    const { deps, stdout } = harness(home, start);

    expect(await runCli(['doctor', '--json', '--url', url], deps)).toBe(0);
    const server = stdout
      .text()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { check: string; status: string; detail: string })
      .find((check) => check.check === 'server');
    expect(server).toMatchObject({ status: 'ok', detail: `${url} runs Brot 0.1.0 (protocol 1)` });
  });

  it('serve starts a real server, reports its port, and stops when the signal aborts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'brot-cli-serve-'));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const { deps, stdout, controller } = harness(home, (options) =>
      startServer({ ...options, home, webhookPort: 0, engines: createEngineRegistry([createMockEngine()]) }),
    );

    const running = runCli(['serve', '--host', '127.0.0.1', '--port', '0'], deps);
    await vi.waitFor(() => expect(stdout.text()).toContain('listening on'));
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(stdout.text())?.[1]);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);

    controller.abort();
    expect(await running).toBe(0);
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
  });
});
