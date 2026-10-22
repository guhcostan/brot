import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpMcpServer, type Bot, type ToolRequest } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { createDesktopService, type DesktopService } from '../desktop/service';
import { fakeProvider, fakeRunner, type FakeRunner } from '../desktop/test-helpers';
import { TAKEOVER_REFUSAL, createTakeoverState, type TakeoverState } from '../desktop/takeover';
import { createBrotMcp } from '../mcp/brot-mcp';
import { createTestContext, type TestContext } from '../testing';
import { createBrowserTools } from './tools';
import { savedLoginSecretNames } from '../vault';
import type { LoginCredentials } from './types';
import type { HostBrowserService, HostBrowserStatus } from './types';

interface HostCall {
  botId: string;
  command: string;
  args: Record<string, unknown>;
}

interface FakeHostBrowser extends HostBrowserService {
  readonly calls: HostCall[];
  readonly fillCalls: Array<{ botId: string; credentials: LoginCredentials }>;
  /** The page a command answers with. */
  reply: (command: string) => Record<string, unknown>;
  /** What pageHost reports; null means the browser is not on a page. */
  pageHostResult: string | null;
  state: HostBrowserStatus;
}

function fakeHostBrowser(): FakeHostBrowser {
  const fake: FakeHostBrowser = {
    calls: [],
    fillCalls: [],
    pageHostResult: null,
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
    async deleteProfile() {
      fake.state = { state: 'stopped' };
    },
    async browserScreen() {
      return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    },
    async browserTakeover() {
      return { active: false };
    },
    async setBrowserTakeover() {
      return { active: false };
    },
    async browserInput() {
      return undefined;
    },
    async pageHost() {
      return fake.pageHostResult;
    },
    async fillLogin(bot, credentials) {
      fake.fillCalls.push({ botId: bot.id, credentials });
    },
    async statusForProfile() {
      return fake.state;
    },
    async closeProfile() {
      fake.state = { state: 'stopped' };
    },
    async deleteProfileDir() {
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

async function waitForPendingApproval(): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [approval] = await ctx.services.repos.approvals.list({ status: 'pending' });
    if (approval !== undefined) return approval.id;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for an approval');
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
      'fill_login',
    ]);
    expect(Object.fromEntries([...tools.values()].map((tool) => [tool.spec.name, tool.spec.risk]))).toEqual({
      browser_open: 'read',
      browser_snapshot: 'read',
      browser_click: 'write',
      browser_type: 'write',
      browser_key: 'write',
      browser_scroll: 'read',
      browser_back: 'read',
      fill_login: 'write',
    });
    const click = expectPrepared(await prepare(hostBot, 'browser_click', { ref: 7 }));
    expect(click.summary).toBe(`Click element 7 in the bot's browser`);
  });
});

describe('gating', () => {
  it('offers the browser tools to a host browser bot and to a desktop bot, but not to a bot with neither', async () => {
    for (const tool of tools.values()) {
      if (tool.spec.name === 'fill_login') continue;
      expect(await tool.enabledFor?.(scopeFor(hostBot))).toBe(true);
      expect(await tool.enabledFor?.(scopeFor(containerBot))).toBe(true);
      expect(await tool.enabledFor?.(scopeFor(plainBot))).toBe(false);
    }
    // fill_login types vault credentials, so only a host browser bot gets it; a container bot has its own browser.
    expect(await tools.get('fill_login')?.enabledFor?.(scopeFor(hostBot))).toBe(true);
    expect(await tools.get('fill_login')?.enabledFor?.(scopeFor(containerBot))).toBe(false);
    expect(await tools.get('fill_login')?.enabledFor?.(scopeFor(plainBot))).toBe(false);
  });

  it('hides the browser tools from a host browser bot when the server runs no host browser', async () => {
    const withoutHost = createBrowserTools({ repos: ctx.services.repos, desktop, takeovers });
    expect(withoutHost.every((tool) => tool.enabledFor)).toBe(true);
    for (const tool of withoutHost) {
      expect(await tool.enabledFor?.(scopeFor(hostBot))).toBe(false);
      if (tool.spec.name !== 'fill_login') expect(await tool.enabledFor?.(scopeFor(containerBot))).toBe(true);
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
      expect(deskNames).not.toContain('fill_login');
      await deskClient.close();

      const hostClient = await connectAs(wired, hosted.id);
      const hostNames = (await hostClient.listTools()).tools.map((tool) => tool.name);
      expect(hostNames.filter((name) => name === 'browser_open')).toHaveLength(1);
      expect(hostNames.some((name) => name === 'computer_screenshot')).toBe(false);
      expect(hostNames).toContain('fill_login');
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

describe('fill_login', () => {
  const values = { username: 'ada@example.com', password: 'correct horse battery staple', totp: 'JBSWY3DPEHPK3PXP' };

  async function savedLogin(overrides: Record<string, unknown> = {}) {
    const id = `login_${randomUUID()}`;
    const names = savedLoginSecretNames(id);
    const login = await ctx.services.repos.savedLogins.create(
      { name: 'GitHub work', host: 'github.com', username: values.username, password: values.password, ...overrides },
      { id, secretNames: names },
    );
    await ctx.services.vault.set(names.username, values.username);
    await ctx.services.vault.set(names.password, values.password);
    if (login.hasTotp) await ctx.services.vault.set(names.totp, values.totp);
    return { login, names };
  }

  function secretValues(refs: readonly string[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const ref of refs) {
      map[ref] = ref.endsWith('.username') ? values.username : ref.endsWith('.password') ? values.password : values.totp;
    }
    return map;
  }

  it('fills on the saved host and declares only value-free secret references', async () => {
    const { login, names } = await savedLogin({ totp: values.totp });
    host.pageHostResult = 'github.com';
    const prepared = expectPrepared(await prepare(hostBot, 'fill_login', { name: login.name }));

    expect(prepared.risk).toBe('write');
    expect(prepared.kind).toBe('other');
    expect(prepared.summary).toBe('Fill the saved login "GitHub work" on github.com');
    expect(prepared.secrets).toEqual([`secret://${names.username}`, `secret://${names.password}`, `secret://${names.totp}`]);
    const wire = JSON.stringify({ summary: prepared.summary, secrets: prepared.secrets });
    expect(wire).not.toContain(values.username);
    expect(wire).not.toContain(values.password);
    expect(wire).not.toContain(values.totp);

    const result = await prepared.run(secretValues(prepared.secrets ?? []));
    expect(result).toEqual({ ok: true, output: 'Filled the saved login for github.com and submitted.' });
    const credentials = host.fillCalls[0]?.credentials;
    expect(credentials).toMatchObject({ host: 'github.com', username: values.username, password: values.password });
    expect(credentials?.totp).toMatch(/^\d{6}$/);
    expect(JSON.stringify(result)).not.toContain(values.username);
    expect(JSON.stringify(result)).not.toContain(values.password);
    expect(JSON.stringify(result)).not.toContain(values.totp);
  });

  it('accepts a subdomain of the saved host and skips the one-time code when the login has none', async () => {
    const { login } = await savedLogin();
    host.pageHostResult = 'login.github.com';
    const prepared = expectPrepared(await prepare(hostBot, 'fill_login', { name: login.name }));
    expect(prepared.secrets).toHaveLength(2);

    const result = await prepared.run(secretValues(prepared.secrets ?? []));
    expect(result.ok).toBe(true);
    expect(host.fillCalls.at(-1)?.credentials.totp).toBeUndefined();
  });

  it('names a missing login', async () => {
    expect(await prepare(hostBot, 'fill_login', { name: 'Missing' })).toEqual({
      error: 'There is no saved login named "Missing".',
    });
  });

  it('refuses when the browser is on another host, naming both hosts and no values', async () => {
    const { login } = await savedLogin();
    host.pageHostResult = 'evil.example';
    const result = await prepare(hostBot, 'fill_login', { name: login.name });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('github.com');
      expect(result.error).toContain('evil.example');
      expect(result.error).not.toContain(values.username);
      expect(result.error).not.toContain(values.password);
    }
  });

  it('refuses when the browser is not on a page', async () => {
    const { login } = await savedLogin();
    host.pageHostResult = null;
    expect(await prepare(hostBot, 'fill_login', { name: login.name })).toMatchObject({
      error: expect.stringContaining('Open github.com'),
    });
  });

  it('reports a missing vault value without typing anything', async () => {
    const { login, names } = await savedLogin();
    host.pageHostResult = 'github.com';
    const prepared = expectPrepared(await prepare(hostBot, 'fill_login', { name: login.name }));
    const result = await prepared.run({ [`secret://${names.username}`]: values.username });
    expect(result).toEqual({ ok: false, output: 'Brot could not read the saved login.' });
    expect(host.fillCalls).toHaveLength(0);
  });

  it('is not offered to a container bot', async () => {
    const { login } = await savedLogin();
    host.pageHostResult = 'github.com';
    expect(await prepare(containerBot, 'fill_login', { name: login.name })).toEqual({ error: 'This bot has no host browser.' });
  });

  it('goes through the broker: edits auto-allows the write, ask mode waits for a person', async () => {
    const request: ToolRequest = {
      callId: 'call_fill_login',
      tool: 'fill_login',
      args: { name: 'GitHub work' },
      kind: 'other',
      risk: 'write',
      summary: 'Fill the saved login "GitHub work" on github.com',
    };

    const edits = await createBot({ computer: 'none', browser: true, approvalMode: 'edits' });
    const editsThread = await ctx.services.repos.threads.create(edits.id);
    const editsRun = await ctx.services.repos.runs.create({ threadId: editsThread.id, botId: edits.id, engine: 'mock' });
    expect(
      await ctx.services.broker.request({ botId: edits.id, threadId: editsThread.id, runId: editsRun.id }, request),
    ).toEqual({ allowed: true });
    expect(await ctx.services.repos.approvals.list()).toHaveLength(0);

    const asking = await createBot({ computer: 'none', browser: true });
    const askThread = await ctx.services.repos.threads.create(asking.id);
    const askRun = await ctx.services.repos.runs.create({ threadId: askThread.id, botId: asking.id, engine: 'mock' });
    const decision = ctx.services.broker.request({ botId: asking.id, threadId: askThread.id, runId: askRun.id }, request);
    const approvalId = await waitForPendingApproval();
    await ctx.services.broker.resolve(approvalId, 'deny');
    expect(await decision).toEqual({ allowed: false, reply: 'Denied by the user.' });
  });
});
