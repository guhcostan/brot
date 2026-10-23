// A minimal MCP server over stdio for eval C7: one read-only tool that returns a stable magic value.
// It uses newline-delimited JSON-RPC, which is how MCP frames messages over stdio, and no dependencies.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const MAGIC = readFileSync(join(import.meta.dirname, 'acme-magic.txt'), 'utf8').trim();
const SERVER_INFO = { name: 'acme-fixture', version: '0.0.0' };
const TOOL = {
  name: 'acme_lookup',
  description: 'Look up the current Acme account and return its workspace id.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const text = line.trim();
  if (text === '') return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (typeof message !== 'object' || message === null) return;
  // Responses to server-initiated requests and notifications need no answer.
  if (message.method === undefined || message.id === undefined) return;
  const { id, method, params = {} } = message;
  if (method === 'initialize') {
    respond(id, {
      protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
    return;
  }
  if (method === 'ping') {
    respond(id, {});
    return;
  }
  if (method === 'tools/list') {
    respond(id, { tools: [TOOL] });
    return;
  }
  if (method === 'tools/call') {
    if (params.name !== TOOL.name) {
      respond(id, { content: [{ type: 'text', text: `unknown tool ${String(params.name)}` }], isError: true });
      return;
    }
    respond(id, { content: [{ type: 'text', text: MAGIC }], isError: false });
    return;
  }
  if (method === 'resources/list') {
    respond(id, { resources: [] });
    return;
  }
  if (method === 'prompts/list') {
    respond(id, { prompts: [] });
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(method)}` } });
});
