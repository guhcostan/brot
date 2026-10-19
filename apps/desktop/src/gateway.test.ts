import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startWebGateway, type WebGateway } from './gateway';

interface Captured {
  method?: string;
  url?: string;
  host?: string;
  origin?: string;
  body: string;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let webRoot: string;
let upstream: Server;
let upstreamPort: number;
let gateway: WebGateway;
let captured: Captured | undefined;
let sseClosed: Promise<void>;
let markSseClosed: () => void;
const cleanups: Array<() => Promise<void>> = [];

const INDEX = '<!doctype html><title>Brot</title><div id="root"></div>';

beforeEach(async () => {
  captured = undefined;
  webRoot = await mkdtemp(join(tmpdir(), 'brot-web-'));
  await mkdir(join(webRoot, 'assets'));
  await writeFile(join(webRoot, 'index.html'), INDEX);
  await writeFile(join(webRoot, 'assets', 'index-abc.js'), 'console.log(1)');
  await writeFile(join(webRoot, 'favicon.svg'), '<svg/>');

  sseClosed = new Promise((resolve) => {
    markSseClosed = resolve;
  });
  upstream = createServer((request, response) => handleUpstream(request, response));
  await listen(upstream);
  upstreamPort = boundPort(upstream);

  gateway = await startWebGateway({ webRoot, port: 0, apiPort: upstreamPort });
});

afterEach(async () => {
  await gateway.close();
  await new Promise<void>((resolve) => {
    upstream.close(() => resolve());
    upstream.closeAllConnections();
  });
  await rm(webRoot, { recursive: true, force: true });
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function handleUpstream(request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    captured = {
      method: request.method,
      url: request.url,
      host: request.headers.host,
      origin: request.headers.origin,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    if (request.url === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.write('event: run.started\ndata: {}\n\n');
      request.on('close', () => markSseClosed());
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json', Connection: 'keep-alive' });
    response.end(JSON.stringify({ echoed: captured.body, method: captured.method }));
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve());
  });
}

function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('not listening');
  return address.port;
}

function send(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });
}

const page = (headers: Record<string, string> = {}) => ({ path: '/', headers: { Host: `127.0.0.1:${gateway.port}`, ...headers } });

describe('web gateway static files', () => {
  it('serves index.html with a strict CSP and no caching', async () => {
    const reply = await send(gateway.port, page());
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(INDEX);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(reply.headers['cache-control']).toBe('no-cache');
    expect(String(reply.headers['content-security-policy'])).toContain("script-src 'self'");
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves hashed assets as immutable', async () => {
    const reply = await send(gateway.port, { path: '/assets/index-abc.js', headers: { Host: `127.0.0.1:${gateway.port}` } });
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('console.log(1)');
    expect(reply.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(reply.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('falls back to the app shell for client routes but returns 404 for missing files', async () => {
    const route = await send(gateway.port, { path: '/chat/thread-1', headers: { Host: `127.0.0.1:${gateway.port}` } });
    expect(route.status).toBe(200);
    expect(route.body).toBe(INDEX);

    const missing = await send(gateway.port, { path: '/assets/missing.js', headers: { Host: `127.0.0.1:${gateway.port}` } });
    expect(missing.status).toBe(404);
  });

  it('never serves files outside the web root', async () => {
    const reply = await send(gateway.port, { path: '/%2e%2e/%2e%2e/etc/passwd', headers: { Host: `127.0.0.1:${gateway.port}` } });
    expect(reply.body).toBe(INDEX);
  });

  it('answers HEAD without a body and rejects other write methods', async () => {
    const head = await send(gateway.port, { ...page(), method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');

    const post = await send(gateway.port, { ...page(), method: 'POST', body: 'x' });
    expect(post.status).toBe(405);
  });

  it('rejects paths that are not valid percent-encoding', async () => {
    const reply = await send(gateway.port, { path: '/%E0%A4%A', headers: { Host: `127.0.0.1:${gateway.port}` } });
    expect(reply.status).toBe(400);
  });
});

describe('web gateway request checks', () => {
  it('rejects a Host header that is not the gateway loopback address (DNS rebinding)', async () => {
    const reply = await send(gateway.port, { path: '/api/bots', headers: { Host: 'evil.test:' + gateway.port } });
    expect(reply.status).toBe(403);
    expect(captured).toBeUndefined();
  });

  it('rejects cross-origin browser requests', async () => {
    const reply = await send(gateway.port, {
      path: '/api/bots',
      headers: { Host: `127.0.0.1:${gateway.port}`, Origin: 'https://evil.test' },
    });
    expect(reply.status).toBe(403);
    expect(captured).toBeUndefined();
  });
});

describe('web gateway /api proxy', () => {
  it('forwards to the server with a loopback Host and without the browser Origin', async () => {
    const reply = await send(gateway.port, {
      path: '/api/bots',
      headers: { Host: `127.0.0.1:${gateway.port}`, Origin: `http://127.0.0.1:${gateway.port}` },
    });
    expect(reply.status).toBe(200);
    expect(captured?.url).toBe('/api/bots');
    expect(captured?.host).toBe(`127.0.0.1:${upstreamPort}`);
    expect(captured?.origin).toBeUndefined();
  });

  it('forwards request bodies for writes', async () => {
    const payload = JSON.stringify({ text: 'hi' });
    const reply = await send(gateway.port, {
      method: 'POST',
      path: '/api/threads/t1/messages',
      headers: { Host: `127.0.0.1:${gateway.port}`, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) },
      body: payload,
    });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ echoed: payload, method: 'POST' });
    expect(captured?.body).toBe(payload);
  });

  it('streams server-sent events and closes the upstream when the browser disconnects', async () => {
    const request = httpRequest({
      host: '127.0.0.1',
      port: gateway.port,
      path: '/api/events',
      headers: { Host: `127.0.0.1:${gateway.port}`, Accept: 'text/event-stream' },
    });
    const firstChunk = await new Promise<string>((resolve, reject) => {
      request.on('response', (response) => {
        expect(response.headers['content-type']).toBe('text/event-stream');
        response.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8')));
        response.once('error', reject);
      });
      request.on('error', reject);
      request.end();
    });
    expect(firstChunk).toContain('event: run.started');
    request.destroy();
    await sseClosed;
  });

  it('survives a browser that disconnects mid-upload', async () => {
    const request = httpRequest({
      host: '127.0.0.1',
      port: gateway.port,
      method: 'POST',
      path: '/api/threads/t1/messages',
      headers: { Host: `127.0.0.1:${gateway.port}`, 'Content-Type': 'application/json', 'Content-Length': '100' },
    });
    request.on('error', () => undefined);
    request.write('{"partial":');
    await new Promise((resolve) => setTimeout(resolve, 20));
    request.destroy();

    const reply = await send(gateway.port, { path: '/api/bots', headers: { Host: `127.0.0.1:${gateway.port}` } });
    expect(reply.status).toBe(200);
  });

  it('answers 502 when the server is not running', async () => {
    const closed = createServer();
    await listen(closed);
    const deadPort = boundPort(closed);
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const down = await startWebGateway({ webRoot, port: 0, apiPort: deadPort });
    cleanups.push(() => down.close());
    const reply = await send(down.port, { path: '/api/bots', headers: { Host: `127.0.0.1:${down.port}` } });
    expect(reply.status).toBe(502);
  });
});
