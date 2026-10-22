import { describe, expect, it } from 'vitest';
import {
  CreateMcpServer,
  McpServer,
  McpServerTestResult,
  UpdateMcpServer,
  secretNameOf,
} from './mcp-servers';

const at = '2026-10-22T12:00:00.000Z';

const roundTrip = <T>(schema: { parse: (input: unknown) => T }, value: unknown): T => {
  const parsed = schema.parse(value);
  return schema.parse(JSON.parse(JSON.stringify(parsed)));
};

const stdio = {
  id: 'mcp_1',
  name: 'my-tools',
  transport: 'stdio' as const,
  command: 'npx',
  args: ['-y', '@example/mcp-server'],
  env: { LOG_LEVEL: 'info', API_KEY: 'secret://mcp-key' },
  enabled: true,
  createdAt: at,
  updatedAt: at,
};

const http = {
  id: 'mcp_2',
  name: 'remote_tools',
  transport: 'http' as const,
  args: [],
  env: {},
  url: 'https://mcp.example.com/mcp',
  enabled: false,
  createdAt: at,
  updatedAt: at,
};

describe('McpServer entity', () => {
  it('round-trips a stdio server and an http server through JSON', () => {
    expect(roundTrip(McpServer, stdio)).toEqual(stdio);
    expect(roundTrip(McpServer, http)).toEqual(http);
  });

  it('requires a command for stdio and a url for http', () => {
    expect(() => McpServer.parse({ ...stdio, command: undefined })).toThrow(/command/);
    expect(() => McpServer.parse({ ...stdio, command: '' })).toThrow();
    expect(() => McpServer.parse({ ...http, url: undefined })).toThrow(/url/);
  });

  it('accepts https anywhere and http only on loopback', () => {
    for (const url of ['https://mcp.example.com/mcp', 'http://localhost:3000/mcp', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      expect(McpServer.parse({ ...http, url }).url).toBe(url);
    }
    for (const url of [
      'http://mcp.example.com/mcp',
      'https://user:pass@mcp.example.com/mcp',
      'https://mcp.example.com/mcp?key=1',
      'https://mcp.example.com/mcp#frag',
      'ftp://mcp.example.com/mcp',
      'not a url',
    ]) {
      expect(() => McpServer.parse({ ...http, url })).toThrow(/url|URL/);
    }
  });

  it('reserves the name brot and validates the name alphabet', () => {
    expect(() => McpServer.parse({ ...stdio, name: 'brot' })).toThrow(/reserved/);
    expect(McpServer.parse({ ...stdio, name: 'a'.repeat(64) }).name).toHaveLength(64);
    for (const name of ['', 'has space', 'dot.name', 'a'.repeat(65), 'emoji😀']) {
      expect(() => McpServer.parse({ ...stdio, name })).toThrow();
    }
  });

  it('accepts plain env values and well-formed secret:// references, and refuses malformed ones', () => {
    expect(McpServer.parse({ ...stdio, env: { A: 'plain', B: 'secret://api.key-1_x' } }).env).toEqual({
      A: 'plain',
      B: 'secret://api.key-1_x',
    });
    for (const value of ['secret://', 'secret://-bad', 'secret://has space', `secret://${'a'.repeat(129)}`]) {
      expect(() => McpServer.parse({ ...stdio, env: { A: value } })).toThrow(/secret/);
    }
  });
});

describe('CreateMcpServer', () => {
  it('defaults to a stdio server with no args, no env and enabled', () => {
    expect(CreateMcpServer.parse({ name: 'tools', command: 'npx' })).toEqual({
      name: 'tools',
      transport: 'stdio',
      command: 'npx',
      args: [],
      env: {},
      enabled: true,
    });
  });

  it('accepts an http server with a url and no command', () => {
    expect(CreateMcpServer.parse({ name: 'remote', transport: 'http', url: 'https://mcp.example.com/mcp' })).toMatchObject({
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      enabled: true,
    });
  });

  it('gives each parsed server its own args and env', () => {
    const first = CreateMcpServer.parse({ name: 'tools', command: 'npx' });
    const second = CreateMcpServer.parse({ name: 'other', command: 'npx' });
    first.args.push('-y');
    first.env.KEY = 'secret://key';
    expect(second.args).toEqual([]);
    expect(second.env).toEqual({});
  });

  it('refuses a transport without its required field', () => {
    expect(() => CreateMcpServer.parse({ name: 'tools' })).toThrow(/command/);
    expect(() => CreateMcpServer.parse({ name: 'remote', transport: 'http' })).toThrow(/url/);
    expect(() => CreateMcpServer.parse({ name: 'brot', command: 'npx' })).toThrow(/reserved/);
  });
});

describe('UpdateMcpServer', () => {
  it('keeps every field optional', () => {
    expect(UpdateMcpServer.parse({})).toEqual({});
    expect(UpdateMcpServer.parse({ enabled: false })).toEqual({ enabled: false });
    expect(UpdateMcpServer.parse({ name: 'renamed', url: 'https://mcp.example.com/mcp' })).toEqual({
      name: 'renamed',
      url: 'https://mcp.example.com/mcp',
    });
  });

  it('validates the fields it carries', () => {
    expect(() => UpdateMcpServer.parse({ name: 'brot' })).toThrow(/reserved/);
    expect(() => UpdateMcpServer.parse({ url: 'http://example.com/mcp' })).toThrow(/url/);
    expect(() => UpdateMcpServer.parse({ env: { A: 'secret://-bad' } })).toThrow(/secret/);
  });
});

describe('McpServerTestResult', () => {
  it('parses a successful handshake and a failure', () => {
    expect(McpServerTestResult.parse({ ok: true, tools: ['search', 'fetch'], latencyMs: 42 })).toEqual({
      ok: true,
      tools: ['search', 'fetch'],
      latencyMs: 42,
    });
    expect(McpServerTestResult.parse({ ok: false, error: 'connection refused' })).toEqual({
      ok: false,
      error: 'connection refused',
    });
    expect(() => McpServerTestResult.parse({ ok: false })).toThrow();
    expect(() => McpServerTestResult.parse({ ok: true, tools: Array.from({ length: 51 }, (_, i) => `t${i}`), latencyMs: 1 })).toThrow();
  });
});

describe('secretNameOf', () => {
  it('reads the vault name of a reference and leaves plain values alone', () => {
    expect(secretNameOf('secret://mcp-key')).toBe('mcp-key');
    expect(secretNameOf('secret://api.key-1_x')).toBe('api.key-1_x');
    expect(secretNameOf('plain-value')).toBeUndefined();
    expect(secretNameOf('secret://-bad')).toBeUndefined();
  });
});
