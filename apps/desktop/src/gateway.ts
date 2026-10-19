import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { contentSecurityPolicy, isLoopbackHost, isLoopbackOrigin, LOOPBACK_HOST } from './security';
import { contentTypeFor, resolveWebPath } from './web-files';

export interface WebGatewayOptions {
  /** Directory with the built web app (index.html and assets). */
  webRoot: string;
  /** Loopback port for the gateway. Zero picks a free port. */
  port: number;
  /** Loopback port of the embedded Brot server that /api is forwarded to. */
  apiPort: number;
}

export interface WebGateway {
  url: string;
  port: number;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Serves the built web app and forwards /api to the embedded server, so the page's relative /api base
 * works from a window without an http origin. Both sit on one loopback origin, so the server's CORS list is
 * not involved. The gateway checks Host and Origin itself because forwarded requests look loopback to it.
 */
export function startWebGateway(options: WebGatewayOptions): Promise<WebGateway> {
  return new Promise((resolvePromise, reject) => {
    const server: Server = createServer((request, response) => {
      route(server, options, request, response).catch(() => {
        if (!response.headersSent) reply(response, 500, 'Internal error');
        else response.destroy();
      });
    });
    server.once('error', reject);
    server.listen({ host: LOOPBACK_HOST, port: options.port }, () => {
      const port = boundPort(server);
      server.off('error', reject);
      resolvePromise({
        url: `http://${LOOPBACK_HOST}:${port}`,
        port,
        close: () => closeServer(server),
      });
    });
  });
}

async function route(server: Server, options: WebGatewayOptions, request: IncomingMessage, response: ServerResponse) {
  const port = boundPort(server);
  if (!isLoopbackHost(request.headers.host, port)) return reply(response, 403, 'Forbidden');
  const origin = request.headers.origin;
  if (origin !== undefined && !isLoopbackOrigin(origin, port)) return reply(response, 403, 'Forbidden');

  const path = (request.url ?? '/').split('?')[0] ?? '/';
  if (path === '/api' || path.startsWith('/api/')) return proxy(request, response, options.apiPort);
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply(response, 405, 'Method not allowed');
  return serveWeb(request, response, options.webRoot, path);
}

function proxy(request: IncomingMessage, response: ServerResponse, apiPort: number): void {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name) || name === 'origin' || name === 'host') continue;
    headers[name] = value;
  }
  headers.host = `${LOOPBACK_HOST}:${apiPort}`;

  const upstream = httpRequest(
    { host: LOOPBACK_HOST, port: apiPort, method: request.method, path: request.url, headers },
    (upstreamResponse) => {
      const responseHeaders: OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        responseHeaders[name] = value;
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) reply(response, 502, 'Bad gateway');
    else response.destroy();
  });
  response.on('close', () => upstream.destroy());
  request.on('error', () => upstream.destroy());
  request.pipe(upstream);
}

async function serveWeb(request: IncomingMessage, response: ServerResponse, root: string, path: string): Promise<void> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return reply(response, 400, 'Bad request');
  }
  const requested = resolveWebPath(root, decoded);
  if (requested === undefined) return reply(response, 404, 'Not found');

  let file = (await regularFile(requested)) ? requested : undefined;
  if (file === undefined) {
    // Unknown routes fall back to the app shell. Missing assets stay 404 so a broken import is visible.
    if (extname(decoded) !== '') return reply(response, 404, 'Not found');
    file = resolveWebPath(root, '/index.html');
    if (file === undefined || !(await regularFile(file))) return reply(response, 404, 'Not found');
  }

  const hashed = decoded.startsWith('/assets/');
  const size = (await stat(file)).size;
  response.writeHead(200, {
    'Content-Type': contentTypeFor(file),
    'Content-Length': size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Security-Policy': contentSecurityPolicy({ kind: 'app' }),
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

async function regularFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function reply(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Web gateway is not listening on a TCP port');
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
    server.closeAllConnections();
  });
}
