import type { McpServer } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const stdioServer: McpServer = {
  id: 'mcp_1',
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  env: { GITHUB_TOKEN: 'secret://github_token' },
  enabled: true,
  createdAt: at,
  updatedAt: at,
};

const httpServer: McpServer = {
  id: 'mcp_2',
  name: 'search',
  transport: 'http',
  args: [],
  env: {},
  url: 'https://mcp.example.com/search',
  enabled: false,
  createdAt: at,
  updatedAt: at,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('mcp server routes', () => {
  it('lists MCP servers', async () => {
    const { fetch, calls } = fakeFetch(() => json([stdioServer, httpServer]));
    const client = createHttpClient({ fetch });

    await expect(client.listMcpServers()).resolves.toEqual([stdioServer, httpServer]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/mcp/servers' });
  });

  it('creates a stdio server with arguments and secret references', async () => {
    const { fetch, calls } = fakeFetch(() => json(stdioServer, 201));
    const client = createHttpClient({ fetch });

    await expect(
      client.createMcpServer({
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { GITHUB_TOKEN: 'secret://github_token' },
      }),
    ).resolves.toEqual(stdioServer);

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/mcp/servers' });
    expect(calls[0]?.body).toMatchObject({
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { GITHUB_TOKEN: 'secret://github_token' },
      enabled: true,
    });
  });

  it('rejects an invalid server before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(stdioServer, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createMcpServer({ name: 'brot', transport: 'stdio', command: 'npx' })).rejects.toThrow();
    await expect(client.createMcpServer({ name: 'has space', transport: 'stdio', command: 'npx' })).rejects.toThrow();
    await expect(client.createMcpServer({ name: 'ok', transport: 'stdio' })).rejects.toThrow();
    await expect(client.createMcpServer({ name: 'ok', transport: 'http', url: 'http://example.com/mcp' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('updates with PATCH and deletes with DELETE', async () => {
    const updated = { ...stdioServer, enabled: false };
    const { fetch, calls } = fakeFetch((call) => (call.method === 'PATCH' ? json(updated) : new Response(null, { status: 204 })));
    const client = createHttpClient({ fetch });

    await expect(client.updateMcpServer('mcp_1', { enabled: false })).resolves.toEqual(updated);
    await expect(client.deleteMcpServer('mcp_1')).resolves.toBeUndefined();

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'PATCH /api/mcp/servers/mcp_1',
      'DELETE /api/mcp/servers/mcp_1',
    ]);
    expect(calls[0]?.body).toEqual({ enabled: false });
  });

  it('runs the handshake and accepts both a success and a failure as 200', async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.path.endsWith('/test')) {
        return json(call.path.includes('mcp_2') ? { ok: false, error: 'connect ECONNREFUSED' } : { ok: true, tools: ['read_file', 'list_directory'], latencyMs: 18 });
      }
      return json([]);
    });
    const client = createHttpClient({ fetch });

    await expect(client.testMcpServer('mcp_1')).resolves.toEqual({ ok: true, tools: ['read_file', 'list_directory'], latencyMs: 18 });
    await expect(client.testMcpServer('mcp_2')).resolves.toEqual({ ok: false, error: 'connect ECONNREFUSED' });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/mcp/servers/mcp_1/test',
      'POST /api/mcp/servers/mcp_2/test',
    ]);
  });

  it('surfaces the 400 issue and the 404 of the MCP routes', async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: 'Invalid request', issues: [{ path: ['name'], message: 'an MCP server with that name already exists' }] }, 400),
    );
    const client = createHttpClient({ fetch });
    await expect(client.createMcpServer({ name: 'filesystem', transport: 'stdio', command: 'npx' })).rejects.toThrow(
      '400 Invalid request: an MCP server with that name already exists',
    );

    const notFound = fakeFetch(() => json({ error: 'MCP server not found' }, 404));
    const missing = createHttpClient({ fetch: notFound.fetch });
    await expect(missing.updateMcpServer('nope', { enabled: false })).rejects.toThrow('404 MCP server not found');
    await expect(missing.deleteMcpServer('nope')).rejects.toThrow('404 MCP server not found');
    await expect(missing.testMcpServer('nope')).rejects.toThrow('404 MCP server not found');
  });

  it('rejects responses that do not match the protocol', async () => {
    const { fetch } = fakeFetch((call) => (call.path.endsWith('/test') ? json({ ok: 'yes' }) : json([{ id: 'mcp_1' }])));
    const client = createHttpClient({ fetch });

    await expect(client.listMcpServers()).rejects.toThrow();
    await expect(client.testMcpServer('mcp_1')).rejects.toThrow();
  });
});
