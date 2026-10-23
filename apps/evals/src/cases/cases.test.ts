import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { fixturePath, outputOf, readFixture, readFixtureJson } from './shared';

interface JsonRpcResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** A tiny MCP client for the C7 fixture: newline-delimited JSON-RPC over the child's stdin/stdout. */
function fixtureClient(): {
  send(message: Record<string, unknown>): void;
  next(): Promise<JsonRpcResponse>;
  close(): void;
} {
  const child = spawn(process.execPath, [fixturePath('c7/acme-mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const queue: JsonRpcResponse[] = [];
  const waiters: Array<(value: JsonRpcResponse) => void> = [];
  lines.on('line', (line) => {
    const parsed = JSON.parse(line) as JsonRpcResponse;
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(parsed);
    else queue.push(parsed);
  });
  return {
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    next() {
      return new Promise<JsonRpcResponse>((resolve, reject) => {
        const queued = queue.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        const timer = setTimeout(() => reject(new Error('timed out waiting for the MCP fixture')), 5000);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
    },
    close() {
      child.kill();
    },
  };
}

describe('C7 MCP fixture', () => {
  it('completes the MCP handshake and returns the magic value from its one tool', async () => {
    const client = fixtureClient();
    try {
      client.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'evals', version: '0' } },
      });
      const init = await client.next();
      expect(init.result).toMatchObject({ protocolVersion: '2024-11-05', serverInfo: { name: 'acme-fixture' } });
      client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

      client.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const listed = await client.next();
      const tools = listed.result?.tools as Array<{ name: string }> | undefined;
      expect(tools?.map((tool) => tool.name)).toEqual(['acme_lookup']);

      client.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'acme_lookup', arguments: {} } });
      const called = await client.next();
      const content = called.result?.content as Array<{ type: string; text: string }> | undefined;
      expect(content?.[0]?.text).toBe(readFixture('c7/acme-magic.txt').trim());

      client.send({ jsonrpc: '2.0', id: 4, method: 'tools/nope', params: {} });
      const unknown = await client.next();
      expect(unknown.error?.code).toBe(-32601);
    } finally {
      client.close();
    }
  });
});

describe('A1 probe', () => {
  it('keeps the exit code, printed to stdout, together with the assertion from stderr', () => {
    const text = outputOf({ stdout: 'EXIT=1\n', stderr: 'AssertionError: expected 6 got 10\n' });
    expect(text).toMatch(/EXIT=[1-9]/);
    expect(text).toContain('expected 6 got 10');
    expect(outputOf({ stdout: 'EXIT=0\n', stderr: '' })).toBe('EXIT=0\n');
  });
});

describe('B1 fixture', () => {
  it('drops every row when the export starts with a byte-order mark, which is the bug Onça is asked to fix', () => {
    const parse = createRequire(import.meta.url)(fixturePath('b1/invoice-export.cjs')) as (text: string) => unknown[];
    expect(parse('invoice_id,amount\nINV-1,120\n')).toHaveLength(1);
    expect(parse('﻿invoice_id,amount\nINV-1,120\n')).toHaveLength(0);
  });
});

describe('A9 fixture', () => {
  it('makes the expected P-2 exception a real breach: the meal is over 60 USD per person', () => {
    const key = readFixtureJson<{ expectedExceptions: Record<string, string> }>('ledger.key.json');
    expect(key.expectedExceptions['R-03']).toBe('P-2');

    const receipt = readFileSync(fixturePath('receipts/R-03.txt'), 'utf8');
    const diners: Record<string, number> = { one: 1, two: 2 };
    const who = /Items: Dinner for (\w+)/.exec(receipt)?.[1] ?? '';
    const total = Number(/Total: ([\d.]+) USD/.exec(receipt)?.[1]);
    expect(diners[who]).toBeDefined();
    expect(total / (diners[who] ?? 1)).toBeGreaterThan(60);
  });
});
