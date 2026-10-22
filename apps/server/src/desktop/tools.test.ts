import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpMcpServer, type Bot, type Thread } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { createApp } from '../app';
import { createBrowserTools } from '../browser/tools';
import { createBrotMcp } from '../mcp/brot-mcp';
import type { BrotMcpService, BrotTool, PreparedCall } from '../mcp/types';
import { createTestContext, type TestContext } from '../testing';
import { createDesktopService, type DesktopService } from './service';
import { createTakeoverState, TAKEOVER_REFUSAL, type TakeoverState } from './takeover';
import { createDesktopTools } from './tools';
import { fakeProvider, fakeRunner, type FakeRunner } from './test-helpers';

let ctx: TestContext;
let runner: FakeRunner;
let desktop: DesktopService;
let takeovers: TakeoverState;
let tools: Map<string, BrotTool>;
let bot: Bot;
let plain: Bot;
let thread: Thread;
let scope: ApprovalScope;

const SCOPE_RUN = 'run_test';

beforeEach(async () => {
  ctx = await createTestContext({ computers: { sandbox: fakeProvider() }, desktop: { takeoverWaitMs: 40, takeoverPollMs: 5 } });
  runner = fakeRunner();
  const { repos, bus } = ctx.services;
  takeovers = createTakeoverState();
  desktop = createDesktopService({ provider: fakeProvider(), repos, bus, runner, takeovers, takeoverWaitMs: 40, takeoverPollMs: 5 });
  bot = await repos.bots.create({
    name: 'Ada',
    job: 'Researcher',
    engine: 'mock',
    instructions: '',
    computer: 'sandbox',
    desktop: true,
    egress: { mode: 'allowlist', allow: ['example.com'] },
  });
  plain = await repos.bots.create({
    name: 'Bo',
    job: 'Helper',
    engine: 'mock',
    instructions: '',
    computer: 'sandbox',
    egress: { mode: 'deny', allow: [] },
  });
  thread = await repos.threads.create(bot.id, { title: 'Chat' });
  await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
  scope = { botId: bot.id, threadId: thread.id, runId: SCOPE_RUN };
  const list = [
    ...createBrowserTools({ repos, desktop, takeovers }),
    ...createDesktopTools({ repos, desktop, takeovers, takeoverWaitMs: 40 }),
  ];
  tools = new Map(list.map((tool) => [tool.spec.name, tool]));
});

afterEach(async () => {
  await ctx.close();
});

async function prepare(name: string, args: Record<string, unknown>): Promise<PreparedCall | { error: string }> {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.prepare(scope, args);
}

function expectPrepared(result: PreparedCall | { error: string }): PreparedCall {
  if ('error' in result) throw new Error(`expected a prepared call, got error: ${result.error}`);
  return result;
}

describe('gating', () => {
  it('offers the desktop tools only to a desktop bot', async () => {
    for (const tool of tools.values()) {
      // fill_login only exists for host browsers; these tools are built without one here.
      if (tool.spec.name === 'fill_login') continue;
      expect(await tool.enabledFor?.(scope)).toBe(true);
    }
    const plainScope = { ...scope, botId: plain.id };
    for (const tool of tools.values()) {
      expect(await tool.enabledFor?.(plainScope)).toBe(false);
    }
  });

  it('declares the spec risk for each tool', () => {
    const risks = Object.fromEntries([...tools.values()].map((tool) => [tool.spec.name, tool.spec.risk]));
    expect(risks).toMatchObject({
      browser_open: 'read',
      browser_snapshot: 'read',
      browser_click: 'write',
      browser_type: 'write',
      browser_key: 'write',
      browser_scroll: 'read',
      browser_back: 'read',
      computer_screenshot: 'read',
      request_takeover: 'read',
    });
  });

  it('refuses every browser tool with the exact message while a takeover is active', async () => {
    takeovers.set(bot.id, { active: true, requestedBy: 'user' });
    for (const name of ['browser_snapshot', 'browser_click', 'browser_scroll', 'computer_screenshot']) {
      const args = name === 'browser_click' ? { ref: 1 } : name === 'browser_scroll' ? { direction: 'down' } : {};
      expect(await prepare(name, args)).toEqual({ error: TAKEOVER_REFUSAL });
    }
    expect(runner.calls).toHaveLength(0);
  });

  it('still lets request_takeover run while a takeover is active', async () => {
    takeovers.set(bot.id, { active: true, requestedBy: 'user' });
    expectPrepared(await prepare('request_takeover', { reason: 'Need the 2FA code' }));
  });

  it('rejects a call with invalid arguments before any approval', async () => {
    const result = await prepare('browser_click', { ref: 'two' });
    expect('error' in result && result.error).toMatch(/Invalid arguments/);
  });

  it('refuses a non-http URL in browser_open', async () => {
    expect('error' in (await prepare('browser_open', { url: 'file:///etc/passwd' }))).toBe(true);
    expect('error' in (await prepare('browser_open', { url: 'javascript:alert(1)' }))).toBe(true);
  });
});

describe('browser_type', () => {
  it('refuses a secret:// value', async () => {
    const result = await prepare('browser_type', { ref: 2, text: 'secret://bank_password' });
    expect(result).toEqual({
      error: 'Secret values cannot be typed by the bot. Call request_takeover and let the person enter them.',
    });
    expect(runner.calls.some((call) => call.argv[0] === 'brot-browser')).toBe(false);
  });

  it('refuses a password or card field, found through the field command', async () => {
    runner.browserReply = (command) =>
      command === 'field' ? { tag: 'input', type: 'password', sensitive: true, reason: 'a password field' } : {};
    const result = await prepare('browser_type', { ref: 4, text: 'hunter2' });
    expect('error' in result && result.error).toMatch(/Refused: element 4 is a password field/);
  });

  it('types into an ordinary field once the field is checked', async () => {
    runner.browserReply = (command) => (command === 'field' ? { type: 'text', sensitive: false, reason: null } : { url: 'https://example.com/', title: 'Form' });
    const prepared = expectPrepared(await prepare('browser_type', { ref: 3, text: 'ada@example.com', submit: false }));
    expect(prepared.risk).toBe('write');
    const result = await prepared.run({});
    expect(result.ok).toBe(true);
    expect(runner.calls.at(-1)?.argv).toEqual(['brot-browser', 'type', JSON.stringify({ ref: '3', text: 'ada@example.com', submit: false })]);
  });
});

describe('computer_screenshot', () => {
  it('returns the frame as an image/jpeg content block', async () => {
    await desktop.start(bot);
    const prepared = expectPrepared(await prepare('computer_screenshot', {}));
    const result = await prepared.run({});
    expect(result.ok).toBe(true);
    expect(result.image?.mimeType).toBe('image/jpeg');
    expect(Buffer.from(result.image?.data ?? '', 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });
});

describe('request_takeover', () => {
  it('waits for the person and reports that control is back', async () => {
    const prepared = expectPrepared(await prepare('request_takeover', { reason: 'Solve the CAPTCHA' }));
    const state = takeovers;
    setTimeout(() => state.set(bot.id, { active: false, requestedBy: 'user' }), 15);
    const result = await prepared.run({});
    expect(result).toEqual({ ok: true, output: 'Control is back. Take a new snapshot.' });
    expect(takeovers.get(bot.id)).toMatchObject({ active: false });
  });

  it('starts the takeover as requested by the bot, with its reason', async () => {
    const prepared = expectPrepared(await prepare('request_takeover', { reason: 'Enter the 2FA code' }));
    const run = prepared.run({});
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(takeovers.get(bot.id)).toMatchObject({ active: true, requestedBy: 'bot', reason: 'Enter the 2FA code' });
    takeovers.set(bot.id, { active: false, requestedBy: 'user' });
    await run;
  });

  it('says so when the person does not hand control back in time', async () => {
    const prepared = expectPrepared(await prepare('request_takeover', { reason: 'Sign in' }));
    const result = await prepared.run({});
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/has not handed control back/);
  });
});

describe('through the Brot MCP server', () => {
  it('lists desktop tools for a desktop bot and none for a plain bot', async () => {
    const mcp: BrotMcpService = createBrotMcp({
      repos: ctx.services.repos,
      broker: ctx.services.broker,
      vault: ctx.services.vault,
      bus: ctx.services.bus,
      tools: [...tools.values()],
    });
    const app = createApp({ ...ctx.services, config: { host: '127.0.0.1', port: 8799, mode: 'server' }, trustLoopback: true, mcp });
    const connect = async (botId: string): Promise<Client> => {
      const runId = `run_${randomBytes(4).toString('hex')}`;
      await ctx.services.repos.runs.create({ threadId: thread.id, botId, engine: 'mock' });
      const spec = HttpMcpServer.parse(mcp.specForRun({ botId, threadId: thread.id, runId }, 'http://127.0.0.1:8799'));
      const client = new Client({ name: 'brot-test', version: '0.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(spec.url), {
          requestInit: { headers: spec.headers },
          fetch: (input, init) => Promise.resolve(app.request(input.toString(), init)),
        }),
      );
      return client;
    };

    const deskClient = await connect(bot.id);
    const names = (await deskClient.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['browser_open', 'browser_snapshot', 'request_takeover']));
    await deskClient.close();

    const plainClient = await connect(plain.id);
    const plainNames = (await plainClient.listTools()).tools.map((tool) => tool.name);
    expect(plainNames.some((name) => name.startsWith('browser_'))).toBe(false);
    await plainClient.close();
  });
});
