import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpMcpServer, type Approval, type Bot, type Memory, type Message, type Run, type Thread } from '@brot/protocol';
import type { ApprovalScope } from '../broker';
import { createApp } from '../app';
import { recordEvents, createTestContext, type TestContext } from '../testing';
import { createBrotMcp } from './brot-mcp';
import type { HttpSendRequest } from './http-request';
import type { BrotMcpService, BrotTool } from './types';

const PUBLIC_ADDRESS = '93.184.216.34';
const API_TOKEN = 'sk-live-0123456789abcdef';

interface Harness {
  ctx: TestContext;
  mcp: BrotMcpService;
  app: ReturnType<typeof createApp>;
  bot: Bot;
  thread: Thread;
  run: Run;
  scope: ApprovalScope;
  sent: HttpSendRequest[];
  client: Client;
  token: string;
  endpoint: string;
  close(): Promise<void>;
}

interface SetupOptions {
  resolve?: (hostname: string) => Promise<string[]>;
  tools?: BrotTool[];
}

async function setup(options: SetupOptions = {}): Promise<Harness> {
  const ctx = await createTestContext();
  const { repos, broker, vault, bus } = ctx.services;
  const bot = await repos.bots.create({
    name: 'Ada',
    job: 'Assistant',
    engine: 'mock',
    instructions: '',
    egress: { mode: 'allowlist', allow: ['api.example.com'] },
  });
  const thread = await repos.threads.create(bot.id, { title: 'Chat' });
  const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
  const scope: ApprovalScope = { botId: bot.id, threadId: thread.id, runId: run.id };

  const sent: HttpSendRequest[] = [];
  const mcp = createBrotMcp({
    repos,
    broker,
    vault,
    bus,
    tools: options.tools,
    http: {
      resolve: options.resolve ?? (async () => [PUBLIC_ADDRESS]),
      send: async (request) => {
        sent.push(request);
        return {
          status: 200,
          statusText: 'OK',
          contentType: 'text/plain',
          body: `authorization=${request.headers.authorization ?? 'none'}`,
          truncated: false,
        };
      },
    },
  });
  const app = createApp({ ...ctx.services, trustLoopback: true, mcp });

  const spec = HttpMcpServer.parse(mcp.specForRun(scope, 'http://127.0.0.1:8799'));
  const token = spec.headers.Authorization?.replace(/^Bearer /, '') ?? '';
  const endpoint = spec.url;

  const client = new Client({ name: 'brot-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: spec.headers },
      fetch: (input, init) => Promise.resolve(app.request(input.toString(), init)),
    }),
  );

  return {
    ctx,
    mcp,
    app,
    bot,
    thread,
    run,
    scope,
    sent,
    client,
    token,
    endpoint,
    async close() {
      await client.close();
      await ctx.close();
    },
  };
}

async function callTool(h: Harness, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await h.client.callTool({ name, arguments: args })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  return result.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

async function waitForApproval(h: Harness): Promise<Approval> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const [approval] = await h.ctx.services.repos.approvals.list({ status: 'pending' });
    if (approval) return approval;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('no approval was requested');
}

async function allowTool(h: Harness, tool: string): Promise<void> {
  await h.ctx.services.repos.policies.create(h.bot.id, { tool, effect: 'allow' });
}

async function threadMessages(h: Harness): Promise<Message[]> {
  return h.ctx.services.repos.messages.listByThread(h.thread.id);
}

/** A raw JSON-RPC request, sent without the SDK client, to test the route's own checks. */
function rawList(h: Harness, headers: Record<string, string>, url = h.endpoint): Promise<Response> {
  return Promise.resolve(
    h.app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }),
  );
}

let h: Harness;

afterEach(async () => {
  await h?.close();
});

describe('run authentication', () => {
  beforeEach(async () => {
    h = await setup();
  });

  it('refuses a request without a run token, even from loopback', async () => {
    const res = await rawList(h, {});
    expect(res.status).toBe(401);
  });

  it('refuses a token that is not issued for this run', async () => {
    const res = await rawList(h, { authorization: `Bearer ${randomBytes(32).toString('base64url')}` });
    expect(res.status).toBe(401);
  });

  it('refuses another run token on this run endpoint', async () => {
    const other = await h.ctx.services.repos.runs.create({ threadId: h.thread.id, botId: h.bot.id, engine: 'mock' });
    const otherSpec = HttpMcpServer.parse(
      h.mcp.specForRun({ botId: h.bot.id, threadId: h.thread.id, runId: other.id }, 'http://127.0.0.1:8799'),
    );
    const res = await rawList(h, otherSpec.headers, h.endpoint);
    expect(res.status).toBe(401);
  });

  it('accepts the run token', async () => {
    const res = await rawList(h, { authorization: `Bearer ${h.token}` });
    expect(res.status).toBe(200);
  });

  it('refuses the token once the run has ended', async () => {
    h.mcp.endRun(h.run.id);
    const res = await rawList(h, { authorization: `Bearer ${h.token}` });
    expect(res.status).toBe(401);
  });

});

describe('tools through the SDK client', () => {
  beforeEach(async () => {
    h = await setup();
  });

  it('lists the built-in tools', async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['http_request', 'notify_user', 'remember']);
  });

  it('runs an allowed call and records the decision', async () => {
    await allowTool(h, 'notify_user');
    const result = await callTool(h, 'notify_user', { title: 'Done', body: 'All set' });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('The user was notified.');
    const messages = await threadMessages(h);
    expect(messages.map((m) => [m.role, m.content])).toEqual([['assistant', '**Done**\n\nAll set']]);
    expect(h.mcp.lastDecisions.at(-1)).toEqual({
      runId: h.run.id,
      tool: 'notify_user',
      decision: { allowed: true },
    });
  });

  it('waits for the broker and runs the handler only after allow', async () => {
    const pending = callTool(h, 'notify_user', { title: 'Ship it?' });
    const approval = await waitForApproval(h);

    expect(approval).toMatchObject({ tool: 'notify_user', kind: 'other', summary: 'Notify the user: Ship it?', status: 'pending' });
    expect(await threadMessages(h)).toEqual([]);

    await h.ctx.services.broker.resolve(approval.id, 'allow_once');
    const result = await pending;
    expect(result.isError).toBeFalsy();
    expect(await threadMessages(h)).toHaveLength(1);
  });

  it('skips the handler and returns the reply when the user denies', async () => {
    const pending = callTool(h, 'notify_user', { title: 'Send it' });
    const approval = await waitForApproval(h);

    await h.ctx.services.broker.resolve(approval.id, 'deny', 'Not yet, ask Sam first');
    const result = await pending;

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Not yet, ask Sam first');
    expect(await threadMessages(h)).toEqual([]);
  });

  it('refuses an invalid call before asking the user', async () => {
    const result = await callTool(h, 'notify_user', { body: 'no title' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Invalid arguments: title/);
    expect(await h.ctx.services.repos.approvals.list({ status: 'pending' })).toEqual([]);
  });

  it('remember stores a memory bound to the run and announces it', async () => {
    const events = recordEvents(h.ctx.services.bus, h.thread.id);
    await allowTool(h, 'remember');
    const result = await callTool(h, 'remember', { content: 'Prefers metric units', kind: 'preference' });
    events.stop();

    expect(result.isError).toBeFalsy();
    const memories: Memory[] = await h.ctx.services.repos.memories.listByBot(h.bot.id);
    expect(memories).toMatchObject([{ kind: 'preference', content: 'Prefers metric units', sourceRunId: h.run.id }]);
    expect(events.list.map((event) => event.type)).toContain('memory.written');
  });

  it('answers an unknown tool with an error and asks nobody', async () => {
    const result = await callTool(h, 'wire_money', {});
    expect(result.isError).toBe(true);
    expect(await h.ctx.services.repos.approvals.list({ status: 'pending' })).toEqual([]);
  });
});

describe('http_request', () => {
  beforeEach(async () => {
    h = await setup();
  });

  it('refuses a host that is not on the egress allowlist, without asking', async () => {
    const events = recordEvents(h.ctx.services.bus, h.thread.id);
    const result = await callTool(h, 'http_request', { method: 'GET', url: 'https://evil.example.net/steal' });
    events.stop();

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not on this bot's egress allowlist");
    expect(h.sent).toEqual([]);
    expect(await h.ctx.services.repos.approvals.list({ status: 'pending' })).toEqual([]);
    expect(events.list).toContainEqual(expect.objectContaining({ type: 'network.blocked', host: 'evil.example.net' }));
  });

  it('refuses an allowlisted host that resolves to loopback', async () => {
    await h.close();
    h = await setup({ resolve: async () => ['127.0.0.1'] });
    const events = recordEvents(h.ctx.services.bus, h.thread.id);
    const result = await callTool(h, 'http_request', { method: 'GET', url: 'https://api.example.com/v1/me' });
    events.stop();

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('resolves to a private, loopback or link-local address');
    expect(h.sent).toEqual([]);
    expect(await h.ctx.services.repos.approvals.list({ status: 'pending' })).toEqual([]);
    expect(events.list).toContainEqual(expect.objectContaining({ type: 'network.blocked', host: 'api.example.com' }));
  });

  it('classifies GET as a read and other methods as irreversible', async () => {
    await allowTool(h, 'http_request');
    const spy = vi.spyOn(h.ctx.services.broker, 'request');

    const get = await callTool(h, 'http_request', { method: 'GET', url: 'https://api.example.com/v1/me' });
    const post = await callTool(h, 'http_request', { method: 'POST', url: 'https://api.example.com/v1/me', body: '{}' });

    expect(textOf(get)).toContain('HTTP 200 OK');
    expect(textOf(post)).toContain('HTTP 200 OK');
    expect(spy.mock.calls.map((call) => call[1].risk)).toEqual(['read', 'irreversible']);
  });

  it('keeps secrets out of the approval, fills them in after allow, and redacts them from the output', async () => {
    await h.ctx.services.vault.set('api-token', API_TOKEN);
    const resolveSpy = vi.spyOn(h.ctx.services.vault, 'resolveRef');

    const pending = callTool(h, 'http_request', {
      method: 'POST',
      url: 'https://api.example.com/v1/items',
      headers: { authorization: 'Bearer secret://api-token' },
      body: '{"name":"x"}',
    });
    const approval = await waitForApproval(h);

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(approval).toMatchObject({ kind: 'send', tool: 'http_request' });
    expect(approval.args).toMatchObject({ headers: { authorization: 'Bearer secret://api-token' } });
    expect(JSON.stringify(await h.ctx.services.repos.approvals.list())).not.toContain(API_TOKEN);

    await h.ctx.services.broker.resolve(approval.id, 'allow_once');
    const result = await pending;

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.headers.authorization).toBe(`Bearer ${API_TOKEN}`);
    expect(h.sent[0]?.address).toBe(PUBLIC_ADDRESS);
    expect(textOf(result)).toContain('authorization=Bearer [redacted]');
    expect(textOf(result)).not.toContain(API_TOKEN);
  });

  it('does not send when a referenced secret is not set', async () => {
    await allowTool(h, 'http_request');
    const result = await callTool(h, 'http_request', {
      method: 'GET',
      url: 'https://api.example.com/v1/me',
      headers: { authorization: 'Bearer secret://missing' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Secret secret://missing is not set.');
    expect(h.sent).toEqual([]);
  });
});

describe('declared secrets', () => {
  it('resolves requiresSecrets after allow, passes the value to the handler, and redacts it', async () => {
    const seen: string[] = [];
    const echo: BrotTool = {
      spec: {
        name: 'echo_token',
        description: 'Echo the stored token. Test tool.',
        inputSchema: { type: 'object', properties: {} },
        risk: 'write',
        requiresSecrets: ['secret://api-token'],
      },
      async prepare() {
        return {
          risk: 'write',
          kind: 'other',
          summary: 'Echo the token',
          async run(secrets) {
            const value = secrets['secret://api-token'] ?? '';
            seen.push(value);
            return { ok: true, output: `token is ${value}` };
          },
        };
      },
    };
    h = await setup({ tools: [echo] });
    await h.ctx.services.vault.set('api-token', API_TOKEN);
    const resolveSpy = vi.spyOn(h.ctx.services.vault, 'resolveRef');
    await allowTool(h, 'echo_token');

    const result = await callTool(h, 'echo_token', {});

    expect(seen).toEqual([API_TOKEN]);
    expect(resolveSpy).toHaveBeenCalledWith('secret://api-token');
    expect(textOf(result)).toBe('token is [redacted]');
  });
});
