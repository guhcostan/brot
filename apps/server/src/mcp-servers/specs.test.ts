import { isAbsolute } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestContext, type TestContext } from '../testing';
import { enabledMcpServerSpecs, mcpServerSpec, mcpSpecName, resolveCommand, resolveEnv } from './specs';
import { stdioFixtureOnPath, type FixtureOnPath } from './test-helpers';

let ctx: TestContext;
let pathFixtures: FixtureOnPath[];

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
  pathFixtures = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(pathFixtures.splice(0).map((fixture) => fixture.restore()));
  await ctx.close();
});

async function onPath(name?: string): Promise<FixtureOnPath> {
  const fixture = await stdioFixtureOnPath(name);
  pathFixtures.push(fixture);
  return fixture;
}

describe('mcpSpecName', () => {
  it('keeps a short name and gives a long one a stable, unique 32-character name', () => {
    expect(mcpSpecName('my-tools')).toBe('my-tools');

    const long = 'a'.repeat(64);
    const name = mcpSpecName(long);
    expect(name).toHaveLength(32);
    expect(name.startsWith('a'.repeat(25))).toBe(true);
    expect(name.endsWith('-')).toBe(false);
    expect(mcpSpecName(long)).toBe(name);
    expect(mcpSpecName('a'.repeat(63) + 'b')).not.toBe(name);
  });
});

describe('resolveEnv', () => {
  it('keeps plain values, resolves references and omits unresolvable secrets', async () => {
    const vault = ctx.services.vault;
    await vault.set('mcp-token', 's3cret-value');

    expect(
      await resolveEnv(
        { PLAIN: 'info', TOKEN: 'secret://mcp-token', MISSING: 'secret://not-there' },
        vault,
      ),
    ).toEqual({ PLAIN: 'info', TOKEN: 's3cret-value' });
  });
});

describe('resolveCommand', () => {
  it('keeps an absolute command that exists and names one that does not', async () => {
    expect(await resolveCommand(process.execPath)).toEqual({ ok: true, command: process.execPath });
    expect(await resolveCommand('/nonexistent/brot-command')).toEqual({
      ok: false,
      error: 'command "/nonexistent/brot-command" does not exist or is not executable',
    });
  });

  it('finds a bare command on PATH and resolves it to an absolute path', async () => {
    const fixture = await onPath();
    const resolved = await resolveCommand(fixture.command);
    expect(resolved.ok).toBe(true);
    expect(resolved.ok && isAbsolute(resolved.command)).toBe(true);
    expect(resolved.ok && resolved.command.startsWith(fixture.dir)).toBe(true);
  });

  it('reports a bare command that is not on PATH with a plain message', async () => {
    expect(await resolveCommand('brot-no-such-command-xyz')).toEqual({
      ok: false,
      error: 'command "brot-no-such-command-xyz" was not found in PATH',
    });
    expect(await resolveCommand('   ')).toEqual({ ok: false, error: 'the command is empty' });
  });
});

describe('enabledMcpServerSpecs', () => {
  it('builds a spec for each enabled server, resolving commands and secrets', async () => {
    const { repos, vault } = ctx.services;
    await vault.set('mcp-token', 's3cret-value');
    const fixture = await onPath();
    await repos.mcpServers.create({
      name: 'local-tools',
      command: fixture.command,
      args: ['server.mjs'],
      env: { TOKEN: 'secret://mcp-token', LEVEL: 'debug' },
    });
    const absolute = await repos.mcpServers.create({ name: 'absolute', command: process.execPath });
    await repos.mcpServers.create({ name: 'remote', transport: 'http', url: 'https://mcp.example.com/mcp' });
    const off = await repos.mcpServers.create({ name: 'disabled', command: process.execPath, enabled: false });

    const specs = await enabledMcpServerSpecs(repos, vault, { mcpServerIds: null });
    expect(specs.map((spec) => spec.name)).toEqual(['absolute', 'local-tools', 'remote']);
    expect(specs.find((spec) => spec.name === 'local-tools')).toMatchObject({
      command: expect.stringMatching(new RegExp(`^${fixture.dir}`)),
      args: ['server.mjs'],
      env: { TOKEN: 's3cret-value', LEVEL: 'debug' },
    });
    expect(specs.find((spec) => spec.name === 'absolute')).toMatchObject({ command: process.execPath });
    expect(absolute.command).toBe(process.execPath);

    await repos.mcpServers.update(off.id, { enabled: true });
    expect((await enabledMcpServerSpecs(repos, vault, { mcpServerIds: null })).map((spec) => spec.name)).toEqual([
      'absolute',
      'disabled',
      'local-tools',
      'remote',
    ]);
  });

  it('skips an unresolvable command but keeps the other servers, logging no env value', async () => {
    const { repos, vault } = ctx.services;
    await vault.set('mcp-token', 's3cret-value');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await repos.mcpServers.create({
      name: 'broken',
      command: 'brot-no-such-command-xyz',
      env: { TOKEN: 'secret://mcp-token' },
    });
    await repos.mcpServers.create({ name: 'good', command: process.execPath });

    const specs = await enabledMcpServerSpecs(repos, vault, { mcpServerIds: null });
    expect(specs.map((spec) => spec.name)).toEqual(['good']);
    const logged = errors.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('"broken"');
    expect(logged).toContain('brot-no-such-command-xyz');
    expect(logged).not.toContain('s3cret-value');
  });

  it('gives a long server name a 32-character spec name the engine accepts', async () => {
    const { repos, vault } = ctx.services;
    const name = 'a'.repeat(64);
    await repos.mcpServers.create({ name, command: process.execPath });
    const [spec] = await enabledMcpServerSpecs(repos, vault, { mcpServerIds: null });
    expect(spec?.name).toHaveLength(32);
  });
});

describe('mcpServerSpec', () => {
  it('resolves a relative stdio command and leaves an http spec alone', async () => {
    const { repos } = ctx.services;
    const fixture = await onPath();
    const stdio = await repos.mcpServers.create({ name: 'local', command: fixture.command });
    const spec = await mcpServerSpec(stdio, {});
    expect(spec).toMatchObject({
      name: 'local',
      command: expect.stringMatching(new RegExp(`^${fixture.dir}`)),
    });

    const web = await repos.mcpServers.create({
      name: 'remote',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
    });
    expect(await mcpServerSpec(web, {})).toEqual({ name: 'remote', url: 'https://mcp.example.com/mcp', headers: {} });
  });
});

describe('per-bot MCP server grants', () => {
  it('attaches every enabled server when the grant is null or absent', async () => {
    const { repos, vault } = ctx.services;
    await repos.mcpServers.create({ name: 'one', command: process.execPath });
    await repos.mcpServers.create({ name: 'two', command: process.execPath });

    expect((await enabledMcpServerSpecs(repos, vault, { mcpServerIds: null })).map((spec) => spec.name)).toEqual([
      'one',
      'two',
    ]);
    expect(
      (await enabledMcpServerSpecs(repos, vault, { mcpServerIds: undefined })).map((spec) => spec.name),
    ).toEqual(['one', 'two']);
  });

  it('attaches only the allowlist, ignoring stale ids and disabled servers', async () => {
    const { repos, vault } = ctx.services;
    const one = await repos.mcpServers.create({ name: 'one', command: process.execPath });
    await repos.mcpServers.create({ name: 'two', command: process.execPath });
    await repos.mcpServers.create({ name: 'off', command: process.execPath, enabled: false });

    const specs = await enabledMcpServerSpecs(repos, vault, { mcpServerIds: [one.id, 'deleted-server-id'] });
    expect(specs.map((spec) => spec.name)).toEqual(['one']);
    expect((await enabledMcpServerSpecs(repos, vault, { mcpServerIds: [] }))).toEqual([]);
  });
});
