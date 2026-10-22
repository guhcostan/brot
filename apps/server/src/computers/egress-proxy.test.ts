import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { type AddressInfo, connect, createServer as createNetServer, type Server, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBlockReporter,
  createEgressProxy,
  createRelay,
  type EgressServer,
  hostAllowed,
  isPublicAddress,
  normalizeHost,
  parseCidr,
  parseSidecarConfig,
  relayRouteAllowed,
  type ResolvedAddress,
} from './egress-proxy';

const PUBLIC = '93.184.216.34';
const SIDECAR_FILE = fileURLToPath(new URL('./egress-proxy.ts', import.meta.url));

const RESOLVED: Record<string, ResolvedAddress[]> = {
  'rebind.allowed.test': [
    { address: PUBLIC, family: 4 },
    { address: '10.0.0.5', family: 4 },
  ],
  'private.allowed.test': [{ address: '10.1.2.3', family: 4 }],
  'loop.allowed.test': [{ address: '127.0.0.1', family: 4 }],
  'meta.allowed.test': [{ address: '169.254.169.254', family: 4 }],
  'v6meta.allowed.test': [{ address: 'fd00:ec2::254', family: 6 }],
  'mapped.allowed.test': [{ address: '::ffff:127.0.0.1', family: 6 }],
  'brot.internal.test': [{ address: '10.0.0.9', family: 4 }],
};

/** Test seam: names resolve from this table, otherwise to a public address. Nothing touches real DNS. */
async function resolveFake(host: string): Promise<ResolvedAddress[]> {
  if (host.startsWith('nxdomain')) throw new Error('ENOTFOUND');
  return RESOLVED[host] ?? [{ address: PUBLIC, family: 4 }];
}

/** Test seam: every connection goes to a local server. The requested port picks which one. */
function dialLocal(ports: Record<number, number>, dialed: Array<[string, number]>) {
  return (address: string, port: number): Socket => {
    dialed.push([address, port]);
    return connect({ host: '127.0.0.1', port: ports[port] ?? 1 });
  };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function echoServer(): Promise<number> {
  const sockets = new Set<Socket>();
  const server: Server = createNetServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    socket.pipe(socket);
  });
  cleanups.push(() => {
    for (const socket of sockets) socket.destroy();
    return closeNet(server);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

async function httpServer(): Promise<number> {
  const server: HttpServer = createHttpServer((req, res) => {
    res.end(`path=${req.url} proxyAuth=${req.headers['proxy-authorization'] ?? 'none'}`);
  });
  cleanups.push(() => closeHttp(server));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

function closeNet(server: Server): Promise<void> {
  return new Promise((done) => server.close(() => done()));
}

function closeHttp(server: HttpServer): Promise<void> {
  return new Promise((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
}

interface Harness {
  port: number;
  blocked: string[];
  dialed: Array<[string, number]>;
  clock: { now: number };
  proxy: EgressServer;
}

async function startProxy(
  allow: string[],
  options: { internal?: { host: string; port: number }; sourceCidr?: string | null; ports?: Record<number, number> } = {},
): Promise<Harness> {
  const blocked: string[] = [];
  const dialed: Array<[string, number]> = [];
  const clock = { now: 1_000_000 };
  const echo = await echoServer();
  const web = await httpServer();
  const proxy = createEgressProxy(
    { allow, internal: options.internal, sourceCidr: options.sourceCidr ?? null },
    {
      resolve: resolveFake,
      dial: dialLocal(options.ports ?? { 443: echo, 80: web, 8799: echo }, dialed),
      onBlocked: (host) => blocked.push(host),
      now: () => clock.now,
    },
  );
  const port = await proxy.listen(0, '127.0.0.1');
  cleanups.push(() => proxy.close());
  return { port, blocked, dialed, clock, proxy };
}

function readHead(socket: Socket): Promise<{ head: string; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) return;
      socket.removeListener('data', onData);
      resolve({ head: buffered.subarray(0, end).toString('latin1'), rest: buffered.subarray(end + 4) });
    };
    socket.on('data', onData);
    socket.once('error', reject);
    socket.once('close', () => reject(new Error('closed before a response head')));
  });
}

function closed(socket: Socket): Promise<void> {
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

function statusOf(head: string): number {
  return Number((head.split(' ')[1] ?? '0').trim());
}

async function connectThrough(port: number, authority: string, extraHeaders = ''): Promise<{ status: number; socket: Socket; rest: Buffer }> {
  const socket = connect({ host: '127.0.0.1', port });
  socket.on('error', () => undefined);
  cleanups.push(async () => {
    socket.destroy();
  });
  await once(socket, 'connect');
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${extraHeaders}\r\n`);
  const { head, rest } = await readHead(socket);
  return { status: statusOf(head), socket, rest };
}

function echoRoundTrip(socket: Socket, text: string): Promise<string> {
  return new Promise((resolve) => {
    let received = '';
    socket.resume();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (received.length >= text.length) resolve(received);
    });
    socket.write(text);
  });
}

async function plainGet(port: number, request: string): Promise<string> {
  const socket = connect({ host: '127.0.0.1', port });
  socket.on('error', () => undefined);
  cleanups.push(async () => {
    socket.destroy();
  });
  await once(socket, 'connect');
  let body = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    body += chunk;
  });
  socket.end(request);
  await closed(socket);
  return body;
}

describe('egress proxy: CONNECT', () => {
  it('tunnels an allowlisted host on 443 to the address it validated, not the name', async () => {
    const h = await startProxy(['allowed.test']);
    const { status, socket } = await connectThrough(h.port, 'allowed.test:443');
    expect(status).toBe(200);
    expect(await echoRoundTrip(socket, 'ping')).toBe('ping');
    expect(h.dialed).toEqual([[PUBLIC, 443]]);
    expect(h.blocked).toEqual([]);
  });

  it('refuses a host outside the allowlist, reports it once, and never reports headers', async () => {
    const h = await startProxy(['allowed.test']);
    const { status, socket } = await connectThrough(h.port, 'evil.test:443', 'Proxy-Authorization: Basic c2VjcmV0\r\n');
    expect(status).toBe(403);
    await closed(socket);
    expect(h.blocked).toEqual(['evil.test']);
    expect(h.dialed).toEqual([]);
  });

  it('deduplicates repeated refusals of the same host within a minute', async () => {
    const h = await startProxy(['allowed.test']);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { status } = await connectThrough(h.port, 'evil.test:443');
      expect(status).toBe(403);
    }
    expect(h.blocked).toEqual(['evil.test']);
    h.clock.now += 60_000;
    await connectThrough(h.port, 'evil.test:443');
    expect(h.blocked).toEqual(['evil.test', 'evil.test']);
  });

  it('matches *.name wildcards for subdomains at any depth, but not the apex', async () => {
    const h = await startProxy(['*.wild.test']);
    expect((await connectThrough(h.port, 'a.wild.test:443')).status).toBe(200);
    expect((await connectThrough(h.port, 'a.b.wild.test:443')).status).toBe(200);
    expect((await connectThrough(h.port, 'wild.test:443')).status).toBe(403);
    expect(h.blocked).toEqual(['wild.test']);
  });

  it('refuses names that resolve to loopback, private, link-local or metadata addresses', async () => {
    const names = ['private.allowed.test', 'loop.allowed.test', 'meta.allowed.test', 'v6meta.allowed.test', 'mapped.allowed.test'];
    const h = await startProxy(names);
    for (const name of names) {
      expect((await connectThrough(h.port, `${name}:443`)).status).toBe(403);
    }
    expect(h.blocked).toEqual(names);
    expect(h.dialed).toEqual([]);
  });

  it('refuses a name when any one of its addresses is private (DNS rebinding)', async () => {
    const h = await startProxy(['rebind.allowed.test']);
    expect((await connectThrough(h.port, 'rebind.allowed.test:443')).status).toBe(403);
    expect(h.dialed).toEqual([]);
  });

  it('refuses ports other than 443 for CONNECT, even for an allowlisted host', async () => {
    const h = await startProxy(['allowed.test']);
    expect((await connectThrough(h.port, 'allowed.test:8443')).status).toBe(403);
    expect((await connectThrough(h.port, 'allowed.test:80')).status).toBe(403);
    expect(h.blocked).toEqual(['allowed.test']);
  });

  it('refuses IP literals, whatever they point at', async () => {
    const h = await startProxy(['allowed.test']);
    expect((await connectThrough(h.port, `${PUBLIC}:443`)).status).toBe(403);
    expect((await connectThrough(h.port, '[2606:4700:4700::1111]:443')).status).toBe(403);
    expect((await connectThrough(h.port, '127.0.0.1:443')).status).toBe(403);
  });

  it('answers 502 when the name does not resolve, without reporting it as a policy refusal', async () => {
    const h = await startProxy(['nxdomain.allowed.test']);
    expect((await connectThrough(h.port, 'nxdomain.allowed.test:443')).status).toBe(502);
    expect(h.blocked).toEqual([]);
  });

  it('answers 400 to a malformed authority', async () => {
    const h = await startProxy(['allowed.test']);
    expect((await connectThrough(h.port, 'allowed.test')).status).toBe(400);
  });

  it('allows the internal endpoint on its exact host and port only', async () => {
    const internal = { host: 'brot.internal.test', port: 8799 };
    const h = await startProxy(['allowed.test'], { internal });
    const ok = await connectThrough(h.port, 'brot.internal.test:8799');
    expect(ok.status).toBe(200);
    expect(await echoRoundTrip(ok.socket, 'mcp')).toBe('mcp');
    expect((await connectThrough(h.port, 'brot.internal.test:8800')).status).toBe(403);
    expect((await connectThrough(h.port, 'other.internal.test:8799')).status).toBe(403);
    expect(h.blocked).toEqual(['brot.internal.test', 'other.internal.test']);
  });

  it('drops clients that are not on the internal subnet', async () => {
    const h = await startProxy(['allowed.test'], { sourceCidr: '10.250.0.0/16' });
    const socket = connect({ host: '127.0.0.1', port: h.port });
    socket.on('error', () => undefined);
    await once(socket, 'connect');
    socket.write('CONNECT allowed.test:443 HTTP/1.1\r\n\r\n');
    const received: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => received.push(chunk));
    await closed(socket);
    expect(Buffer.concat(received).length).toBe(0);
  });
});

describe('egress proxy: plain HTTP', () => {
  it('forwards an allowlisted host on port 80 in origin form, without proxy credentials', async () => {
    const h = await startProxy(['allowed.test']);
    const body = await plainGet(
      h.port,
      'GET http://allowed.test/hello?x=1 HTTP/1.1\r\nHost: allowed.test\r\nProxy-Authorization: Basic c2VjcmV0\r\nProxy-Connection: keep-alive\r\n\r\n',
    );
    expect(body).toContain('path=/hello?x=1 proxyAuth=none');
    expect(h.dialed).toEqual([[PUBLIC, 80]]);
  });

  it('refuses other ports, other hosts and https absolute URIs', async () => {
    const h = await startProxy(['allowed.test']);
    expect(await plainGet(h.port, 'GET http://allowed.test:8080/ HTTP/1.1\r\nHost: allowed.test:8080\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
    expect(await plainGet(h.port, 'GET http://evil.test/ HTTP/1.1\r\nHost: evil.test\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
    expect(await plainGet(h.port, 'GET https://allowed.test/ HTTP/1.1\r\nHost: allowed.test\r\n\r\n')).toMatch(/^HTTP\/1\.1 400/);
    expect(h.blocked).toEqual(['allowed.test', 'evil.test']);
  });

  it('refuses a plain HTTP request to a name that resolves privately', async () => {
    const h = await startProxy(['private.allowed.test']);
    expect(await plainGet(h.port, 'GET http://private.allowed.test/ HTTP/1.1\r\nHost: private.allowed.test\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
    expect(h.dialed).toEqual([]);
  });
});

describe('relay routes', () => {
  it.each([
    ['GET', '/mcp/runs/run_1'],
    ['POST', '/mcp/runs/run_1/'],
    ['DELETE', '/mcp/runs/run_1?session=abc'],
    ['POST', '/llm/runs/run_1/v1/chat/completions'],
    ['GET', '/llm/runs/run_1/v1/models'],
  ])('forwards %s %s', (method, target) => {
    expect(relayRouteAllowed(method, target)).toBe(true);
  });

  it.each([
    ['GET', '/api/threads'],
    ['POST', '/api/runs/run_1/cancel'],
    ['GET', '/mcp/runs/'],
    ['GET', '/mcp/runsx/run_1'],
    ['GET', '//mcp/runs/run_1'],
    ['DELETE', '/llm/runs/run_1/v1/models'],
    ['GET', '/llm/runs/run_1/api/threads'],
    ['GET', '/mcp/runs/run_1/%2e%2e/%2e%2e/api/threads'],
    ['GET', '/mcp/runs/run_1/../../api/threads'],
    ['GET', 'http://brot.internal.test/mcp/runs/run_1'],
    ['CONNECT', 'brot.internal.test:8799'],
    ['GET', '/mcp/runs/run_1#fragment'],
  ])('refuses %s %s', (method, target) => {
    expect(relayRouteAllowed(method, target)).toBe(false);
  });
});

describe('egress relay', () => {
  /** A relay to a local HTTP server that echoes the request path. Records every dial. */
  async function relayToWeb(): Promise<{ port: number; dialed: Array<[string, number]> }> {
    const web = await httpServer();
    const dialed: Array<[string, number]> = [];
    const relay = createRelay({ host: 'brot.internal.test', port: 8799 }, { sourceCidr: null }, {
      resolve: resolveFake,
      dial: dialLocal({ 8799: web }, dialed),
    });
    const port = await relay.listen(0, '127.0.0.1');
    cleanups.push(() => relay.close());
    return { port, dialed };
  }

  /** Sends raw bytes and resolves with everything the relay returns before it closes the connection. */
  function exchange(port: number, bytes: string): Promise<string> {
    return new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      let received = '';
      socket.setEncoding('latin1');
      socket.on('data', (chunk: string) => (received += chunk));
      socket.on('error', () => undefined);
      socket.on('close', () => resolve(received));
      socket.write(bytes);
    });
  }

  it('forwards the MCP endpoint and the model relay of a run', async () => {
    const { port, dialed } = await relayToWeb();
    const mcp = await exchange(port, 'POST /mcp/runs/run_1 HTTP/1.1\r\nHost: brot\r\nContent-Length: 4\r\nConnection: close\r\n\r\nping');
    const llm = await exchange(port, 'POST /llm/runs/run_1/v1/chat/completions HTTP/1.1\r\nHost: brot\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}');
    expect(mcp).toContain('HTTP/1.1 200');
    expect(mcp).toContain('path=/mcp/runs/run_1');
    expect(llm).toContain('path=/llm/runs/run_1/v1/chat/completions');
    expect(dialed).toEqual([
      ['10.0.0.9', 8799],
      ['10.0.0.9', 8799],
    ]);
  });

  it('refuses /api/* through the relay and never dials the Brot server for it', async () => {
    const { port, dialed } = await relayToWeb();
    const response = await exchange(port, 'GET /api/threads HTTP/1.1\r\nHost: brot\r\nConnection: close\r\n\r\n');
    expect(response).toBe('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    expect(dialed).toEqual([]);
  });

  it.each([
    ['a traversal out of the run route', 'GET /mcp/runs/run_1/../../api/threads HTTP/1.1\r\nHost: brot\r\nConnection: close\r\n\r\n'],
    ['an absolute-form target', 'GET http://brot.internal.test/api/threads HTTP/1.1\r\nHost: brot\r\nConnection: close\r\n\r\n'],
    ['a CONNECT tunnel', 'CONNECT brot.internal.test:8799 HTTP/1.1\r\nHost: brot.internal.test:8799\r\n\r\n'],
    ['a request that is not HTTP', 'SSH-2.0-OpenSSH_9.9\r\n\r\n'],
    ['both Content-Length and chunked framing', 'POST /mcp/runs/run_1 HTTP/1.1\r\nHost: brot\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n'],
    ['an upgrade request', 'GET /mcp/runs/run_1 HTTP/1.1\r\nHost: brot\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'],
  ])('refuses %s with 403 and closes', async (_label, request) => {
    const { port, dialed } = await relayToWeb();
    const response = await exchange(port, request);
    expect(response.startsWith('HTTP/1.1 403 Forbidden\r\n')).toBe(true);
    expect(dialed).toEqual([]);
  });

  it('checks every request on a kept-alive connection, not only the first', async () => {
    const { port, dialed } = await relayToWeb();
    const socket = connect({ host: '127.0.0.1', port });
    let received = '';
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('error', () => undefined);
    cleanups.push(async () => {
      socket.destroy();
    });
    socket.write('POST /mcp/runs/run_1 HTTP/1.1\r\nHost: brot\r\nContent-Length: 4\r\n\r\nping');
    await waitFor(() => received.includes('path=/mcp/runs/run_1'));
    socket.write('GET /api/threads HTTP/1.1\r\nHost: brot\r\n\r\n');
    await closed(socket);
    expect(received).toContain('path=/mcp/runs/run_1');
    expect(received).toContain('HTTP/1.1 403 Forbidden');
    expect(received).not.toContain('/api/threads');
    expect(dialed).toHaveLength(1);
  });

  it('keeps a chunked request body as body, so text inside it is not read as a request', async () => {
    const { port } = await relayToWeb();
    const socket = connect({ host: '127.0.0.1', port });
    let received = '';
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('error', () => undefined);
    cleanups.push(async () => {
      socket.destroy();
    });
    const body = 'GET /api/evil HTTP/1.1\r\nHost: brot\r\n\r\n';
    socket.write(`POST /mcp/runs/run_1 HTTP/1.1\r\nHost: brot\r\nTransfer-Encoding: chunked\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`);
    await waitFor(() => received.includes('path=/mcp/runs/run_1'));
    socket.write('GET /mcp/runs/run_2 HTTP/1.1\r\nHost: brot\r\nConnection: close\r\n\r\n');
    await closed(socket);
    expect(received).toContain('path=/mcp/runs/run_2');
    expect(received).not.toContain('403');
  });

  it('streams a response as the Brot server produces it', async () => {
    const release: { open?: () => void } = {};
    const gate = new Promise<void>((resolve) => {
      release.open = resolve;
    });
    const web: HttpServer = createHttpServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: first\n\n');
      void gate.then(() => res.end('data: second\n\n'));
    });
    cleanups.push(() => closeHttp(web));
    web.listen(0, '127.0.0.1');
    await once(web, 'listening');
    const webPort = (web.address() as AddressInfo).port;
    const dialed: Array<[string, number]> = [];
    const relay = createRelay({ host: 'brot.internal.test', port: 8799 }, { sourceCidr: null }, {
      resolve: resolveFake,
      dial: dialLocal({ 8799: webPort }, dialed),
    });
    const port = await relay.listen(0, '127.0.0.1');
    cleanups.push(() => relay.close());

    const socket = connect({ host: '127.0.0.1', port });
    let received = '';
    socket.setEncoding('latin1');
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('error', () => undefined);
    cleanups.push(async () => {
      socket.destroy();
    });
    socket.write('GET /mcp/runs/run_1 HTTP/1.1\r\nHost: brot\r\n\r\n');
    await waitFor(() => received.includes('data: first'));
    expect(received).not.toContain('second');
    release.open?.();
    await waitFor(() => received.includes('data: second'));
  });
});

describe('address and host checks', () => {
  it.each([
    ['93.184.216.34', true],
    ['8.8.8.8', true],
    ['172.32.0.1', true],
    ['2606:4700:4700::1111', true],
    ['2001:4860:4860::8888', true],
    ['::ffff:8.8.8.8', true],
    ['64:ff9b::808:808', true],
    ['10.0.0.1', false],
    ['172.16.5.5', false],
    ['192.168.1.1', false],
    ['127.0.0.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['100.100.100.200', false],
    ['168.63.129.16', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['255.255.255.255', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fd00:ec2::254', false],
    ['fc00::1', false],
    ['ff02::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:169.254.169.254', false],
    ['64:ff9b::a00:1', false],
    ['2002:c0a8:101::', false],
    ['2001:db8::1', false],
    ['not-an-address', false],
  ])('isPublicAddress(%s) is %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it('matches exact names and wildcard subdomains only', () => {
    const allow = ['api.example.com', '*.example.com'];
    expect(hostAllowed('api.example.com', allow)).toBe(true);
    expect(hostAllowed('a.example.com', allow)).toBe(true);
    expect(hostAllowed('a.b.example.com', allow)).toBe(true);
    expect(hostAllowed('example.com', allow)).toBe(false);
    expect(hostAllowed('evilexample.com', allow)).toBe(false);
    expect(hostAllowed('example.com.evil.test', allow)).toBe(false);
    expect(hostAllowed('other.example.com.attacker.test', allow)).toBe(false);
    expect(hostAllowed('x.api.example.com', ['api.example.com'])).toBe(false);
  });

  it('normalizes case and one trailing dot', () => {
    expect(normalizeHost('Example.COM.')).toBe('example.com');
  });

  it('rejects malformed CIDRs', () => {
    expect(() => parseCidr('10.0.0.0')).toThrow();
    expect(() => parseCidr('10.0.0.0/33')).toThrow();
    expect(() => parseCidr('nope/8')).toThrow();
  });
});

describe('block reporter', () => {
  it('reports each host once per window and caps the rate', () => {
    const reported: string[] = [];
    let now = 0;
    const report = createBlockReporter((host) => reported.push(host), () => now);
    report('a.test');
    report('a.test');
    expect(reported).toEqual(['a.test']);
    now = 60_000;
    report('a.test');
    expect(reported).toEqual(['a.test', 'a.test']);

    const burst: string[] = [];
    const limited = createBlockReporter((host) => burst.push(host), () => 0);
    for (let index = 0; index < 100; index++) limited(`host${index}.test`);
    expect(burst).toHaveLength(30);
  });

  it('skips hosts that cannot be a network.blocked host, and survives a failing sink', () => {
    const reported: string[] = [];
    const report = createBlockReporter((host) => reported.push(host), () => 0);
    report('bad host');
    report('x/y');
    report('');
    expect(reported).toEqual([]);
    const broken = createBlockReporter(() => {
      throw new Error('sink failed');
    });
    expect(() => broken('ok.test')).not.toThrow();
  });
});

describe('sidecar configuration', () => {
  const valid = {
    allow: ['api.example.com', '*.example.org'],
    internal: { host: 'host.docker.internal', port: 8799 },
    subnet: '172.28.0.0/16',
    proxyPort: 3128,
  };

  it('accepts a well-formed configuration', () => {
    expect(parseSidecarConfig(JSON.stringify(valid))).toEqual(valid);
  });

  it.each([
    ['missing', undefined],
    ['not JSON', '{'],
    ['an array', '[]'],
    ['an uppercase or path entry', JSON.stringify({ ...valid, allow: ['Bad.example.com/x'] })],
    ['an IP entry', JSON.stringify({ ...valid, allow: ['10.0.0.1'] })],
    ['a bad subnet', JSON.stringify({ ...valid, subnet: 'not-a-cidr' })],
    ['a bad internal port', JSON.stringify({ ...valid, internal: { host: 'h', port: 0 } })],
    ['a bad proxy port', JSON.stringify({ ...valid, proxyPort: 70000 })],
  ])('rejects %s without echoing the configuration', (_label, raw) => {
    let message = '';
    try {
      parseSidecarConfig(raw);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('example');
  });
});

describe('sidecar process', () => {
  it('runs from its own TypeScript file under Node, refuses denied hosts, and reports them on stdout', async () => {
    const proxyPort = await freePort();
    const relayPort = await freePort();
    const config = {
      allow: ['allowed.example'],
      internal: { host: 'host.docker.internal', port: relayPort },
      subnet: '127.0.0.0/8',
      proxyPort,
    };
    const child: ChildProcess = spawn(process.execPath, [SIDECAR_FILE], {
      env: { BROT_EGRESS_CONFIG: JSON.stringify(config) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanups.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    await waitFor(() => stderr.includes('egress sidecar ready'));

    const { status, socket } = await connectThrough(proxyPort, 'evil.example:443', 'Authorization: Bearer hunter2\r\n');
    expect(status).toBe(403);
    socket.destroy();
    await waitFor(() => stdout.includes('"host":"evil.example"'));
    expect(stdout).toContain('{"brot":"blocked","host":"evil.example"}');
    expect(stdout).not.toContain('hunter2');
  });
});

async function freePort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await closeNet(server);
  return port;
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
