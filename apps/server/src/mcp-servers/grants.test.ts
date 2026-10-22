import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
});

afterEach(async () => {
  await ctx.close();
});

async function mcpServer(name: string): Promise<string> {
  const server = await ctx.services.repos.mcpServers.create({ name, command: 'node' });
  return server.id;
}

async function createBot(overrides: Record<string, unknown> = {}): Promise<Response> {
  return call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', ...overrides });
}

function issuePaths(bodyText: string): { path: string[]; message: string }[] {
  return (JSON.parse(bodyText) as { issues: { path: string[]; message: string }[] }).issues;
}

describe('POST /api/bots with an MCP server grant', () => {
  it('stores an allowlist of known servers', async () => {
    const first = await mcpServer('first');
    const second = await mcpServer('second');
    const res = await createBot({ mcpServerIds: [first, second] });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Bot).mcpServerIds).toEqual([first, second]);
  });

  it('stores an empty allowlist and an explicit null', async () => {
    expect(((await (await createBot({ mcpServerIds: [] })).json()) as Bot).mcpServerIds).toEqual([]);
    expect(((await (await createBot({ mcpServerIds: null })).json()) as Bot).mcpServerIds).toBeUndefined();
    expect(((await (await createBot()).json()) as Bot).mcpServerIds).toBeUndefined();
  });

  it('rejects unknown ids with a 400 on mcpServerIds', async () => {
    const known = await mcpServer('known');
    const res = await createBot({ mcpServerIds: [known, 'deleted-one', 'deleted-two'] });
    expect(res.status).toBe(400);
    const issues = issuePaths(await res.text());
    expect(issues[0]?.path).toEqual(['mcpServerIds']);
    expect(issues[0]?.message).toContain('deleted-one');
    expect(issues[0]?.message).toContain('deleted-two');
    expect(issues[0]?.message).not.toContain(known);
    expect((await ctx.services.repos.bots.list()).length).toBe(0);
  });

  it('rejects more than 50 ids', async () => {
    const res = await createBot({ mcpServerIds: Array.from({ length: 51 }, (_, i) => `mcp_${i}`) });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/bots/:id MCP server grant', () => {
  it('sets, clears and empties the allowlist', async () => {
    const first = await mcpServer('first');
    const second = await mcpServer('second');
    const bot = (await (await createBot()).json()) as Bot;

    const set = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { mcpServerIds: [first, second] });
    expect(set.status).toBe(200);
    expect(((await set.json()) as Bot).mcpServerIds).toEqual([first, second]);

    const empty = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { mcpServerIds: [] });
    expect(((await empty.json()) as Bot).mcpServerIds).toEqual([]);

    const all = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { mcpServerIds: null });
    expect(((await all.json()) as Bot).mcpServerIds).toBeUndefined();
  });

  it('rejects an unknown id and leaves the stored grant alone', async () => {
    const known = await mcpServer('known');
    const bot = (await (await createBot({ mcpServerIds: [known] })).json()) as Bot;

    const res = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { mcpServerIds: ['gone'] });
    expect(res.status).toBe(400);
    expect(issuePaths(await res.text())[0]?.path).toEqual(['mcpServerIds']);
    expect(((await (await call(ctx.app, 'GET', `/api/bots/${bot.id}`)).json()) as Bot).mcpServerIds).toEqual([known]);
  });

  it('drops the id of a deleted server from the bot it was granted to', async () => {
    const server = await mcpServer('goes-away');
    const bot = (await (await createBot({ mcpServerIds: [server] })).json()) as Bot;

    expect((await call(ctx.app, 'DELETE', `/api/mcp/servers/${server}`)).status).toBe(204);

    const res = await call(ctx.app, 'GET', `/api/bots/${bot.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Bot).mcpServerIds).toEqual([]);
  });
});
