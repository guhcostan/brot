import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServer } from '@brot/protocol';
import { createTestContext, type TestContext } from '../testing';
import { testMcpServer } from './handshake';
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
  await Promise.all(pathFixtures.splice(0).map((fixture) => fixture.restore()));
  await ctx.close();
});

async function stored(overrides: Record<string, unknown>): Promise<McpServer> {
  return ctx.services.repos.mcpServers.create({ name: 'test-server', ...overrides });
}

describe('a stdio handshake', () => {
  it('lists the fixture tools and reports the latency', async () => {
    const server = await stored({ command: process.execPath, args: [stdioFixture()] });
    const result = await testMcpServer(server, { vault: ctx.services.vault });
    expect(result).toMatchObject({ ok: true, tools: ['echo', 'read_env'] });
    expect(result.ok && result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves a secret env value into the child process', async () => {
    await ctx.services.vault.set('mcp-token', 's3cret-value');
    const server = await stored({
      command: process.execPath,
      args: [stdioFixture()],
      env: { BROT_FIXTURE_REQUIRE_ENV: 'BROT_TEST_TOKEN', BROT_TEST_TOKEN: 'secret://mcp-token' },
    });
    expect(await testMcpServer(server, { vault: ctx.services.vault })).toMatchObject({ ok: true });
  });

  it('omits an unresolvable secret, so the child starts without it and the handshake fails cleanly', async () => {
    const server = await stored({
      command: process.execPath,
      args: [stdioFixture()],
      env: { BROT_FIXTURE_REQUIRE_ENV: 'BROT_TEST_TOKEN', BROT_TEST_TOKEN: 'secret://not-in-the-vault' },
    });
    const result = await testMcpServer(server, { vault: ctx.services.vault });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toEqual(expect.any(String));
    expect(!result.ok && result.error).not.toContain('secret://');
  });

  it.skipIf(process.platform === 'win32')('resolves a bare command on PATH and runs it', async () => {
    const fixture = await stdioFixtureOnPath();
    pathFixtures.push(fixture);
    const server = await stored({ command: fixture.command });
    expect(await testMcpServer(server, { vault: ctx.services.vault })).toMatchObject({
      ok: true,
      tools: ['echo', 'read_env'],
    });
  });

  it('reports a bare command that is not on PATH with a plain message and no env value', async () => {
    await ctx.services.vault.set('mcp-token', 's3cret-value');
    const server = await stored({
      command: 'brot-no-such-command-xyz',
      env: { TOKEN: 'secret://mcp-token' },
    });
    const result = await testMcpServer(server, { vault: ctx.services.vault });
    expect(result).toEqual({
      ok: false,
      error: 'command "brot-no-such-command-xyz" was not found in PATH',
    });
    expect(result.ok || !result.error.includes('s3cret-value')).toBe(true);
  });

  it('reports an absolute command that does not exist clearly', async () => {
    const server = await stored({ command: '/nonexistent/brot-mcp-command' });
    expect(await testMcpServer(server, { vault: ctx.services.vault })).toEqual({
      ok: false,
      error: 'command "/nonexistent/brot-mcp-command" does not exist or is not executable',
    });
  });

  it('refuses a command that is only whitespace', async () => {
    const server = { ...(await stored({ command: 'node' })), command: '   ' };
    expect(await testMcpServer(server, { vault: ctx.services.vault })).toEqual({
      ok: false,
      error: 'the command is empty',
    });
  });

  it('scrubs resolved env values out of an error', async () => {
    const secret = `/nonexistent-brot-test-${process.pid}`;
    await ctx.services.vault.set('mcp-token', secret);
    const server = await stored({
      command: secret,
      env: { TOKEN: 'secret://mcp-token' },
    });
    const result = await testMcpServer(server, { vault: ctx.services.vault });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).not.toContain(secret);
  });
});

describe('an http handshake', () => {
  it('lists the tools of a real streamable HTTP server', async () => {
    const fake = await fakeHttpMcpServer();
    httpServers.push(fake);
    const server = await stored({ name: 'remote', transport: 'http', url: fake.url });
    expect(await testMcpServer(server, { vault: ctx.services.vault })).toMatchObject({
      ok: true,
      tools: ['http_ping'],
    });
  });

  it('reports an unreachable url as a failed handshake, never as a thrown error', async () => {
    const server = await stored({ name: 'remote', transport: 'http', url: 'http://127.0.0.1:1/mcp' });
    const result = await testMcpServer(server, { vault: ctx.services.vault });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.length).toBeGreaterThan(0);
  });

  it('gives up at the timeout with a plain message', async () => {
    const silent: Server = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as AddressInfo;
    try {
      const server = await stored({ name: 'remote', transport: 'http', url: `http://127.0.0.1:${port}/mcp` });
      const result = await testMcpServer(server, { vault: ctx.services.vault, timeoutMs: 100 });
      expect(result).toEqual({ ok: false, error: 'the MCP server did not answer within 100 milliseconds' });
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
