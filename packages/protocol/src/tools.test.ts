import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BrotToolSpec,
  HttpMcpServer,
  JsonSchemaObject,
  McpServerSpec,
  SecretRef,
  StdioMcpServer,
  ToolRisk,
} from './tools';

const sendEmail = {
  name: 'send_email',
  description: 'Send an email from the bot account',
  inputSchema: z.toJSONSchema(z.object({ to: z.string(), body: z.string() })),
  risk: 'irreversible',
  requiresSecrets: ['secret://gmail-app-password'],
};

describe('ToolRisk', () => {
  it('accepts the three levels and nothing else', () => {
    for (const risk of ['read', 'write', 'irreversible']) expect(ToolRisk.parse(risk)).toBe(risk);
    expect(() => ToolRisk.parse('dangerous')).toThrow();
  });
});

describe('SecretRef', () => {
  it('accepts secret:// references', () => {
    expect(SecretRef.parse('secret://gmail-app-password')).toBe('secret://gmail-app-password');
    expect(SecretRef.parse('secret://github.token_2')).toBe('secret://github.token_2');
  });

  it('rejects bare names, other schemes and empty names', () => {
    for (const value of ['gmail-app-password', 'env://TOKEN', 'secret://', 'secret://has space', 'secret:///x']) {
      expect(() => SecretRef.parse(value)).toThrow();
    }
  });
});

describe('BrotToolSpec', () => {
  it('accepts a tool with a JSON Schema input and secrets', () => {
    expect(BrotToolSpec.parse(sendEmail)).toEqual(sendEmail);
  });

  it('makes requiresSecrets optional', () => {
    const { requiresSecrets: _unused, ...rest } = sendEmail;
    expect(BrotToolSpec.parse({ ...rest, risk: 'read' })).toMatchObject({ risk: 'read' });
  });

  it('rejects names that MCP clients cannot carry', () => {
    for (const name of ['send.email', 'send email', '', 'a'.repeat(65)]) {
      expect(() => BrotToolSpec.parse({ ...sendEmail, name })).toThrow();
    }
  });

  it('requires an object-typed input schema', () => {
    expect(() => BrotToolSpec.parse({ ...sendEmail, inputSchema: { type: 'string' } })).toThrow();
    expect(() => BrotToolSpec.parse({ ...sendEmail, inputSchema: undefined })).toThrow();
  });

  it('rejects an unknown risk and a non-secret requirement', () => {
    expect(() => BrotToolSpec.parse({ ...sendEmail, risk: 'critical' })).toThrow();
    expect(() => BrotToolSpec.parse({ ...sendEmail, requiresSecrets: ['gmail-app-password'] })).toThrow();
  });
});

describe('JsonSchemaObject', () => {
  it('keeps the other JSON Schema keywords', () => {
    const schema = { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] };
    expect(JsonSchemaObject.parse(schema)).toEqual(schema);
  });
});

describe('McpServerSpec', () => {
  it('parses a stdio server and fills env and args', () => {
    const parsed = McpServerSpec.parse({ name: 'brot', command: 'node', args: ['mcp.js'] });
    expect(parsed).toEqual({ name: 'brot', command: 'node', args: ['mcp.js'], env: {} });
    expect('command' in parsed).toBe(true);
  });

  it('parses an http server and fills headers', () => {
    const parsed = McpServerSpec.parse({ name: 'brot', url: 'http://127.0.0.1:8799/mcp' });
    expect(parsed).toEqual({ name: 'brot', url: 'http://127.0.0.1:8799/mcp', headers: {} });
    expect('url' in parsed).toBe(true);
  });

  it('keeps env and headers as string maps', () => {
    expect(StdioMcpServer.parse({ name: 'x', command: 'x', env: { MODE: 'brot' } }).env).toEqual({ MODE: 'brot' });
    const remote = HttpMcpServer.parse({ name: 'x', url: 'https://mcp.example.com', headers: { 'x-run': '1' } });
    expect(remote.headers).toEqual({ 'x-run': '1' });
    expect(() => StdioMcpServer.parse({ name: 'x', command: 'x', env: { MODE: 1 } })).toThrow();
  });

  it('rejects non-http URLs, empty commands and bad server names', () => {
    expect(() => HttpMcpServer.parse({ name: 'x', url: 'ws://127.0.0.1:8799' })).toThrow();
    expect(() => HttpMcpServer.parse({ name: 'x', url: 'not a url' })).toThrow();
    expect(() => StdioMcpServer.parse({ name: 'x', command: '' })).toThrow();
    expect(() => StdioMcpServer.parse({ name: 'has space', command: 'node' })).toThrow();
    expect(() => McpServerSpec.parse({ name: 'x' })).toThrow();
  });
});
