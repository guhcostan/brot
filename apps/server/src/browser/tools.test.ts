import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpMcpServer, type Bot } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { createDesktopService, type DesktopService } from '../desktop/service';
import { fakeProvider, fakeRunner, type FakeRunner } from '../desktop/test-helpers';
import { TAKEOVER_REFUSAL, createTakeoverState, type TakeoverState } from '../desktop/takeover';
import { createBrotMcp } from '../mcp/brot-mcp';
import { createTestContext, type TestContext } from '../testing';
import { createBrowserTools } from './tools';
import type { HostBrowserService, HostBrowserStatus } from './types';

interface HostCall {
  botId: string;
  command: string;
  args: Record<string, unknown>;
}

interface FakeHostBrowser extends HostBrowserService {
  readonly calls: HostCall[];
  /** The page a command answers with. */
  reply: (command: string) => Record<string, unknown>;
  state: HostBrowserStatus;
}

function fakeHostBrowser(): FakeHostBrowser {
  const fake: FakeHostBrowser = {
    calls: [],
    state: { state: 'stopped' },
    reply: () => ({ url: 'about:blank', title: '' }),
    async browser(bot, command, args) {
      fake.calls.push({ botId: bot.id, command, args });
      return fake.reply(command);
    },
    async status() {
      return fake.state;
    },
    async openForLogin() {
      fake.state = { state: 'login' };
      return fake.state;
    },
    async close() {
      fake.state = { state: 'stopped' };
    },
    async closeAll() {
      fake.state = { state: 'stopped' };
    },
  };
  return fake;
}

let ctx: TestContext;
let runner: FakeRunner;
let desktop: DesktopService;
let takeovers: TakeoverState;
let host: FakeHostBrowser;
let tools: Map<string, ReturnType<typeof createBrowserTools>[number]>;
let containerBot: Bot;
let hostBot: Bot;
let plainBot: Bot;

async function createBot(overrides: Record<string, unknown>): Promise<Bot> {
  return ctx.services.repos.bots.create({ name: 'Bot', job: 'Test', engine: 'mock', ...overrides });
}

function scopeFor(bot: Bot): ApprovalScope {
  return { botId: bot.id, threadId: 'thread_test', runId: 'run_test' };
}

async function prepare(bot: Bot, name: string, args: Record<string, unknown>) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.prepare(scopeFor(bot), args);
}

function expectPrepared(
  result: Awaited<ReturnType<ReturnType<typeof createBrowserTools>[number]['prepare']>>,
) {
  if ('error' in result) throw new Error(`expected a prepared call, got error: ${result.error}`);
  return result;
}

beforeEach(async () => {
  ctx = await createTestContext({ computers: { sandbox: fakeProvider() } });
  runner = fakeRunner();
  host = fakeHostBrowser();
  takeovers = createTakeoverState();
  const { repos, bus } = ctx.services;
  desktop = createDesktopService({ provider: fakeProvider(), repos, bus, runner, takeovers });
  tools = new Map(
    createBrowserTools({ repos, desktop, host, takeovers }).map((tool) => [tool.spec.name, tool]),
  );
  containerBot = await createBot({ computer: 'sandbox', desktop: true, browser: true });
  hostBot = await createBot({ computer: 'none', browser: true });
  plainBot = await createBot({ computer: 'none' });
});

afterEach(async () => {
  await ctx.close();
});

describe('registration', () => {
  it('declares each browser tool exactly once, with today\'s names, risks and summaries', async () => {
    expect(createBrowserTools({ repos: ctx.services.repos, desktop, host, takeovers }).map((tool) => tool.spec.name)).toEqual([
      'browser_open',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_key',
      'browser_scroll',
      'browser_back',
    ]);
    expect(Object.fromEntries([...tools.values()].map((tool) => [tool.spec.name, tool.spec.risk]))).toEqual({
      browser_open: 'read',
      browser_snapshot: 'read',
      browser_click: 'write',
      browser_type: 'write',
      browser_key: 'write',
      browser_scroll: 'read',
      browser_back: 'read',
    });
    const click = expectPrepared(await prepare(hostBot, 'browser_click', { ref: 7 }));
    expect(click.summary).toBe(`Click element 7 in the bot's browser`);
  });
});

describe('gating', () => {
  it('offers the browser tools to a host browser bot and to a desktop bot, but not to a bot with neither', async () => {
    for (const tool of tools.values()) {
      expect(await tool.enabledFor?.(scopeFor(hostBot))).toBe(true);
      expect(await tool.enabledFor?.(scopeFor(containerBot))).toBe(true);
      expect(await tool.enabledFor?.(scopeFor(plainBot))).toBe(false);
    }
  });

  it('hides the browser tools from a host browser bot when the server runs no host browser', async () => {
    const withoutHost = createBrowserTools({ repos: ctx.services.repos, desktop, takeovers });
    expect(withoutHost.every((tool) => tool.enabledFor)).toBe(true);
    for (const tool of withoutHost) {
      expect(await tool.enabledFor?.(scopeFor(hostBot))).toBe(false);
      expect(await tool.enabledFor?.(scopeFor(containerBot))).toBe(true);
    }
  });

  it('refuses a bot with no browser before an approval is asked', async () => {
    expect(await prepare(plainBot, 'browser_open', { url: 'https://example.com' })).toEqual({
      error: 'This bot has no browser.',
    });
  });
});

describe('driver routing', () => {
  it('routes a browser bot that has no desktop computer to the host browser', async () => {
    host.reply = (command) => (command === 'open' ? { url: 'https://example.com/', title: 'Example Domain' } : {});
    const prepared = expectPrepared(await prepare(hostBot, 'browser_open', { url: 'https://example.com' }));
    const result = await prepared.run({});
    expect(result).toEqual({
      ok: true,
      output: 'Opened "Example Domain" at https://example.com/. Take a snapshot to read it.',
    });
    expect(host.calls).toEqual([{ botId: hostBot.id, command: 'open', args: { url: 'https://example.com' } }]);
    expect(runner.calls).toHaveLength(0);
  });

  it('keeps a desktop sandbox bot on its container browser, even with browser: true', async () => {
    runner.browserReply = (command) => (command === 'open' ? { url: 'https://example.com/', title: 'Example Domain' } : {});
    const prepared = expectPrepared(await prepare(containerBot, 'browser_open', { url: 'https://example.com' }));
    const result = await prepared.run({});
    expect(result.ok).toBe(true);
    expect(host.calls).toHaveLength(0);
    expect(runner.calls.at(-1)?.argv).toEqual([
      'brot-browser',
      'open',
      JSON.stringify({ url: 'https://example.com' }),
    ]);
  });

  it('reports a host browser failure as a failed tool result', async () => {
    host.reply = () => {
      throw new Error('Chrome is not installed');
    };
    const prepared = expectPrepared(await prepare(hostBot, 'browser_snapshot', {}));
    expect(await prepared.run({})).toEqual({ ok: false, output: 'Chrome is not installed' });
  });
});

describe('refusals', () => {
  it('refuses the container tools while the person has control, but still serves the host browser', async () => {
    takeovers.set(containerBot.id, { active: true, requestedBy: 'user' });
    takeovers.set(hostBot.id, { active: true, requestedBy: 'user' });
    expect(await prepare(containerBot, 'browser_snapshot', {})).toEqual({ error: TAKEOVER_REFUSAL });
    expectPrepared(await prepare(hostBot, 'browser_snapshot', {}));
  });

  it('still refuses a secret:// value on either driver', async () => {
    for (const bot of [hostBot, containerBot]) {
      expect(await prepare(bot, 'browser_type', { ref: 2, text: 'secret://bank_password' })).toEqual({
        error: 'Secret values cannot be typed by the bot. Call request_takeover and let the person enter them.',
      });
    }
    expect(host.calls).toHaveLength(0);
    expect(runner.calls).toHaveLength(0);
  });

  it('checks the field through the same driver that would type into it', async () => {
    host.reply = (command) =>
      command === 'field' ? { tag: 'input', type: 'password', sensitive: true, reason: 'a password field' } : {};
    expect(await prepare(hostBot, 'browser_type', { ref: 4, text: 'hunter2' })).toEqual({
      error: 'Refused: element 4 is a password field. Call request_takeover and let the person fill it.',
    });
    expect(host.calls).toEqual([{ botId: hostBot.id, command: 'field', args: { ref: '4' } }]);

    host.reply = (command) => (command === 'field' ? { sensitive: false } : {});
    const prepared = expectPrepared(await prepare(hostBot, 'browser_type', { ref: 3, text: 'ada@example.com' }));
    expect(await prepared.run({})).toMatchObject({ ok: true });
    expect(host.calls.at(-1)).toEqual({
      botId: hostBot.id,
      command: 'type',
      args: { ref: '3', text: 'ada@example.com', submit: false },
    });
  });
});

/** Connects an MCP client as the run of `botId`, through the test app the services are mounted on. */
async function connectAs(context: TestContext, botId: string): Promise<Client> {
  const mcp = context.services.mcp;
  if (mcp === undefined) throw new Error('the test context has no MCP server');
  const thread = await context.services.repos.threads.create(botId, { title: 'Browser' });
  const runId = `run_${randomBytes(4).toString('hex')}`;
  await context.services.repos.runs.create({ threadId: thread.id, botId, engine: 'mock' });
  const spec = HttpMcpServer.parse(mcp.specForRun({ botId, threadId: thread.id, runId }, 'http://127.0.0.1:8799'));
  const client = new Client({ name: 'brot-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(spec.url), {
      requestInit: { headers: spec.headers },
      fetch: (input, init) => Promise.resolve(context.app.request(input.toString(), init)),
    }),
  );
  return client;
}

describe('services wiring', () => {
  it('registers each browser tool once, for the host and for the container', async () => {
    const wired = await createTestContext({ mcp: createBrotMcp });
    try {
      expect(wired.services.browser).toBeDefined();
      const desk = await wired.services.repos.bots.create({
        name: 'Desk',
        job: 'x',
        engine: 'mock',
        computer: 'sandbox',
        desktop: true,
      });
      const hosted = await wired.services.repos.bots.create({
        name: 'Hosted',
        job: 'x',
        engine: 'mock',
        computer: 'none',
        browser: true,
      });

      const deskClient = await connectAs(wired, desk.id);
      const deskNames = (await deskClient.listTools()).tools.map((tool) => tool.name);
      expect(deskNames.filter((name) => name === 'browser_open')).toHaveLength(1);
      expect(deskNames).toContain('computer_screenshot');
      await deskClient.close();

      const hostClient = await connectAs(wired, hosted.id);
      const hostNames = (await hostClient.listTools()).tools.map((tool) => tool.name);
      expect(hostNames.filter((name) => name === 'browser_open')).toHaveLength(1);
      expect(hostNames.some((name) => name === 'computer_screenshot')).toBe(false);
      await hostClient.close();
    } finally {
      await wired.close();
    }
  });

  it('serves host browsers when the server has no sandbox computer provider', async () => {
    const wired = await createTestContext({ computers: {}, mcp: createBrotMcp });
    try {
      const hosted = await wired.services.repos.bots.create({
        name: 'Hosted',
        job: 'x',
        engine: 'mock',
        computer: 'none',
        browser: true,
      });
      const client = await connectAs(wired, hosted.id);
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('browser_open');
      await client.close();
    } finally {
      await wired.close();
    }
  });
});
