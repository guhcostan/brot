import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServer, McpServerTestResult } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';
import {
  fakeHttpMcpServer,
  stdioFixture,
  stdioFixtureOnPath,
  type FakeHttpMcpServer,
  type FixtureOnPath,
} from './test-helpers';

let ctx: TestContext;
let httpServers: FakeHttpMcpServer[];
let pathFixtures: FixtureOnPath[];

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
  httpServers = [];
  pathFixtures = [];
});

afterEach(async () => {
  await Promise.all(httpServers.splice(0).map((server) => server.close()));
  await Promise.all(pathFixtures.splice(0).map((entry) => entry.restore()));
  await ctx.close();
});

/** A stored config for the real stdio fixture. */
function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'fixture', command: process.execPath, args: [stdioFixture()], ...overrides };
}

async function create(body: Record<string, unknown>): Promise<McpServer> {
  const res = await call(ctx.app, 'POST', '/api/mcp/servers', body);
  expect(res.status).toBe(201);
  return (await res.json()) as McpServer;
}

describe('GET /api/mcp/servers', () => {
  it('starts empty', async () => {
    const res = await call(ctx.app, 'GET', '/api/mcp/servers');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe('MCP server CRUD', () => {
  it('creates, lists, updates and deletes a server', async () => {
    const server = await create(fixture());
    expect(server).toMatchObject({
      name: 'fixture',
      transport: 'stdio',
      command: process.execPath,
      args: [stdioFixture()],
      env: {},
      enabled: true,
    });

    const listed = await call(ctx.app, 'GET', '/api/mcp/servers');
    expect((await listed.json()) as McpServer[]).toEqual([server]);

    const patched = await call(ctx.app, 'PATCH', `/api/mcp/servers/${server.id}`, { name: 'renamed', enabled: false });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ id: server.id, name: 'renamed', enabled: false });
    expect((await call(ctx.app, 'PATCH', '/api/mcp/servers/nope', { enabled: true })).status).toBe(404);

    expect((await call(ctx.app, 'DELETE', `/api/mcp/servers/${server.id}`)).status).toBe(204);
    expect((await call(ctx.app, 'DELETE', `/api/mcp/servers/${server.id}`)).status).toBe(404);
    expect(await (await call(ctx.app, 'GET', '/api/mcp/servers')).json()).toEqual([]);
  });

  it('rejects an invalid body, a reserved name and a duplicate name', async () => {
    const missingCommand = await call(ctx.app, 'POST', '/api/mcp/servers', { name: 'tools' });
    expect(missingCommand.status).toBe(400);

    const reserved = await call(ctx.app, 'POST', '/api/mcp/servers', { name: 'brot', command: 'node' });
    expect(reserved.status).toBe(400);

    const missingUrl = await call(ctx.app, 'POST', '/api/mcp/servers', { name: 'remote', transport: 'http' });
    expect(missingUrl.status).toBe(400);

    await create(fixture());
    const duplicate = await call(ctx.app, 'POST', '/api/mcp/servers', fixture());
    expect(duplicate.status).toBe(400);
    const body = (await duplicate.json()) as { error: string; issues: { path: string[] }[] };
    expect(body.error).toBe('Invalid request');
    expect(body.issues.some((issue) => issue.path.includes('name'))).toBe(true);
  });

  it('validates the server that an update merges into, and refuses a duplicate rename', async () => {
    await create(fixture({ name: 'other' }));
    const web = await create({ name: 'remote', transport: 'http', url: 'https://mcp.example.com/mcp' });

    const broken = await call(ctx.app, 'PATCH', `/api/mcp/servers/${web.id}`, { transport: 'stdio' });
    expect(broken.status).toBe(400);
    const fixed = await call(ctx.app, 'PATCH', `/api/mcp/servers/${web.id}`, {
      transport: 'stdio',
      command: 'node',
    });
    expect(fixed.status).toBe(200);
    expect(await fixed.json()).toMatchObject({ transport: 'stdio', command: 'node' });

    const clash = await call(ctx.app, 'PATCH', `/api/mcp/servers/${web.id}`, { name: 'other' });
    expect(clash.status).toBe(400);
  });
});

describe('env secret references', () => {
  it('stores and returns env references, never the values behind them', async () => {
    await ctx.services.vault.set('mcp-token', 's3cret-value');
    const server = await create(fixture({ env: { TOKEN: 'secret://mcp-token', LEVEL: 'debug' } }));
    expect(server.env).toEqual({ TOKEN: 'secret://mcp-token', LEVEL: 'debug' });

    const listed = await call(ctx.app, 'GET', '/api/mcp/servers');
    const text = await listed.text();
    expect(text).not.toContain('s3cret-value');
    expect((JSON.parse(text) as McpServer[])[0]?.env).toEqual({ TOKEN: 'secret://mcp-token', LEVEL: 'debug' });
  });
});

describe('POST /api/mcp/servers/:id/test', () => {
  it('lists the tools of a stdio server after a real handshake', async () => {
    const server = await create(fixture());
    const res = await call(ctx.app, 'POST', `/api/mcp/servers/${server.id}/test`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpServerTestResult;
    expect(body).toMatchObject({ ok: true, tools: ['echo', 'read_env'] });
    expect(body.ok && typeof body.latencyMs).toBe('number');
  });

  it('resolves the stored secret env values for the handshake and never echoes one', async () => {
    await ctx.services.vault.set('mcp-token', 's3cret-value');
    const server = await create(
      fixture({
        env: { BROT_FIXTURE_REQUIRE_ENV: 'BROT_TEST_TOKEN', BROT_TEST_TOKEN: 'secret://mcp-token' },
      }),
    );
    const res = await call(ctx.app, 'POST', `/api/mcp/servers/${server.id}/test`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('answers a failed handshake with 200 and ok: false, including an omitted secret', async () => {
    const server = await create(
      fixture({
        env: { BROT_FIXTURE_REQUIRE_ENV: 'BROT_TEST_TOKEN', BROT_TEST_TOKEN: 'secret://not-in-the-vault' },
      }),
    );
    const res = await call(ctx.app, 'POST', `/api/mcp/servers/${server.id}/test`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpServerTestResult;
    expect(body.ok).toBe(false);
    expect(!body.ok && body.error).toEqual(expect.any(String));
    expect(!body.ok && body.error).not.toContain('secret://');
  });

  it('tests a real http server', async () => {
    const fake = await fakeHttpMcpServer();
    httpServers.push(fake);
    const server = await create({ name: 'remote', transport: 'http', url: fake.url });
    const res = await call(ctx.app, 'POST', `/api/mcp/servers/${server.id}/test`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tools: ['http_ping'] });
  });

  it('reports an unreachable url as a 200 with ok: false', async () => {
    const server = await create({ name: 'remote', transport: 'http', url: 'http://127.0.0.1:1/mcp' });
    const res = await call(ctx.app, 'POST', `/api/mcp/servers/${server.id}/test`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as McpServerTestResult).ok).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('resolves a bare command on PATH before the handshake', async () => {
    const launcher = await stdioFixtureOnPath();
    pathFixtures.push(launcher);
    const server = await create({ name: 'path-fixture', command: launcher.command });
    const res = await call(ctx.app, 'POST', `/api/mcp/servers/${server.id}/test`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tools: ['echo', 'read_env'] });
  });

  it('answers ok:false for a command that is not on PATH, without any env value', async () => {
    await ctx.services.vault.set('mcp-token', 's3cret-value');
    const server = await create({
      name: 'missing-command',
      command: 'brot-no-such-command-xyz',
      env: { TOKEN: 'secret://mcp-token' },
    });
    const res = await call(ctx.app, 'POST', `/api/mcp/servers/${server.id}/test`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as McpServerTestResult;
    expect(body).toEqual({ ok: false, error: 'command "brot-no-such-command-xyz" was not found in PATH' });
    expect(JSON.stringify(body)).not.toContain('s3cret-value');
  });

  it('answers 404 for an unknown server and requires a JSON write', async () => {
    expect((await call(ctx.app, 'POST', '/api/mcp/servers/nope/test')).status).toBe(404);
    const server = await create(fixture());
    const noContentType = await ctx.app.request(`/api/mcp/servers/${server.id}/test`, { method: 'POST' });
    expect(noContentType.status).toBe(415);
  });
});
