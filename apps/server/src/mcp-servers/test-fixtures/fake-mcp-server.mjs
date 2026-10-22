// A minimal MCP server over stdio, used by tests to prove a real handshake and that the child gets its env.
// It never writes an env value anywhere: only the name of a missing variable reaches stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const required = process.env.BROT_FIXTURE_REQUIRE_ENV;
if (required !== undefined && required !== '' && !process.env[required]) {
  process.stderr.write(`missing the required environment variable ${required}\n`);
  process.exit(2);
}

const server = new McpServer({ name: 'brot-test-mcp', version: '0.0.0' });

server.registerTool('echo', { description: 'A tool that only exists so handshakes can list it.' }, async () => ({
  content: [{ type: 'text', text: 'ok' }],
}));

server.registerTool('read_env', { description: 'A second tool, so the tool list has more than one name.' }, async () => ({
  content: [{ type: 'text', text: 'checked' }],
}));

await server.connect(new StdioServerTransport());
