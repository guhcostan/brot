import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendPinned } from './http-request';

let server: Server;
let port: number;

beforeEach(async () => {
  server = createServer((request, response) => {
    if (request.url === '/big') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(10_000));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(`hello from ${request.headers.host}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('sendPinned', () => {
  it('connects to the validated address even when the name does not resolve', async () => {
    // `.test` is reserved and never resolves, so a 200 proves the socket went to the pinned address.
    const response = await sendPinned({
      url: new URL(`http://pinned.test:${port}/hello`),
      method: 'GET',
      headers: {},
      address: '127.0.0.1',
      signal: AbortSignal.timeout(5000),
      maxResponseBytes: 1024,
    });
    expect(response).toEqual({
      status: 200,
      statusText: 'OK',
      contentType: 'text/plain',
      body: `hello from pinned.test:${port}`,
      truncated: false,
    });
  });

  it('stops reading at the byte limit and says so', async () => {
    const response = await sendPinned({
      url: new URL(`http://pinned.test:${port}/big`),
      method: 'GET',
      headers: {},
      address: '127.0.0.1',
      signal: AbortSignal.timeout(5000),
      maxResponseBytes: 1024,
    });
    expect(response.truncated).toBe(true);
    expect(response.body).toHaveLength(1024);
  });
});
