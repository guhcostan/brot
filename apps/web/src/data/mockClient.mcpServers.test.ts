import { McpServer } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock MCP servers', () => {
  it('seeds a stdio and an http server', async () => {
    const client = createMockClient();
    const servers = await client.listMcpServers();

    expect(servers.map((server) => server.name)).toEqual(['filesystem', 'search']);
    expect(servers.find((server) => server.name === 'filesystem')).toMatchObject({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
      env: { GITHUB_TOKEN: 'secret://github_token' },
      enabled: true,
    });
    expect(servers.find((server) => server.name === 'search')).toMatchObject({
      transport: 'http',
      url: 'https://mcp.example.com/search',
      enabled: false,
    });
    for (const server of servers) expect(() => McpServer.parse(server)).not.toThrow();
  });

  it('creates, updates and deletes a server', async () => {
    const client = createMockClient();
    const created = await client.createMcpServer({
      name: 'notes',
      transport: 'stdio',
      command: 'node',
      args: ['notes-server.js'],
      env: { NOTES_TOKEN: 'secret://notes_token' },
    });
    expect(created).toMatchObject({ name: 'notes', transport: 'stdio', enabled: true, args: ['notes-server.js'] });
    expect(created.createdAt).toBeTruthy();

    const updated = await client.updateMcpServer(created.id, { enabled: false, name: 'notes-v2' });
    expect(updated).toMatchObject({ name: 'notes-v2', enabled: false });

    await client.deleteMcpServer(created.id);
    expect((await client.listMcpServers()).some((server) => server.id === created.id)).toBe(false);
    await expect(client.updateMcpServer(created.id, { enabled: true })).rejects.toThrow();
    await expect(client.deleteMcpServer(created.id)).rejects.toThrow();
  });

  it('refuses duplicate names and invalid transports', async () => {
    const client = createMockClient();
    await expect(client.createMcpServer({ name: 'filesystem', transport: 'stdio', command: 'npx' })).rejects.toThrow();
    await expect(client.createMcpServer({ name: 'brot', transport: 'stdio', command: 'npx' })).rejects.toThrow();
    await expect(client.updateMcpServer('mcp_search', { name: 'filesystem' })).rejects.toThrow();
    // Switching to http without a url breaks the merged server's transport requirements.
    await expect(client.updateMcpServer('mcp_filesystem', { transport: 'http' })).rejects.toThrow();
  });

  it('fake-tests the handshake with a tool list and latency', async () => {
    const client = createMockClient();
    await expect(client.testMcpServer('mcp_filesystem')).resolves.toEqual({
      ok: true,
      tools: ['read_file', 'list_directory'],
      latencyMs: 18,
    });
    await expect(client.testMcpServer('mcp_search')).resolves.toEqual({ ok: true, tools: ['search'], latencyMs: 42 });
    await expect(client.testMcpServer('nope')).rejects.toThrow();
  });
});
