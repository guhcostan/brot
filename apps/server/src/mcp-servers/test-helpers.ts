import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/** The tiny MCP server tests spawn over stdio. It requires `BROT_FIXTURE_REQUIRE_ENV`'s variable when that is set. */
export function stdioFixture(): string {
  return fileURLToPath(new URL('./test-fixtures/fake-mcp-server.mjs', import.meta.url));
}

export interface FixtureOnPath {
  /** A command name reachable only because the temp dir is at the head of PATH. */
  command: string;
  dir: string;
  /** Removes the temp dir and restores PATH. */
  restore(): Promise<void>;
}

/**
 * Puts an executable launcher for the stdio fixture on PATH, so a PATH-relative command resolves the way a
 * bare `node` would. Spawning the launcher itself only works on POSIX; Windows tests use it for resolution.
 */
export async function stdioFixtureOnPath(name = 'brot-fake-stdio'): Promise<FixtureOnPath> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-mcp-path-'));
  if (process.platform === 'win32') {
    await writeFile(join(dir, `${name}.cmd`), `@"${process.execPath}" "${stdioFixture()}" %*\r\n`);
  } else {
    await writeFile(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${stdioFixture()}" "$@"\n`, {
      mode: 0o755,
    });
  }
  const previous = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${previous ?? ''}`;
  return {
    command: name,
    dir,
    async restore() {
      if (previous === undefined) delete process.env.PATH;
      else process.env.PATH = previous;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface FakeHttpMcpServer {
  url: string;
  close(): Promise<void>;
}

/**
 * A real MCP server over Streamable HTTP on loopback, with one tool named `http_ping`. It mirrors the stateless
 * transport Brot's own MCP route uses, so the client handshake is the same as against a real remote server.
 */
export async function fakeHttpMcpServer(): Promise<FakeHttpMcpServer> {
  const http: Server = createServer((request, response) => {
    void serve(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const server = new McpServer({ name: 'fake-http', version: '0.0.0' });
    server.registerTool('http_ping', { description: 'Ping the fake server.' }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      await transport.handleRequest(request, response);
    } finally {
      await server.close();
    }
  }

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    async close() {
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
