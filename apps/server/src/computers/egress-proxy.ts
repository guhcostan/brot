import { lookup } from 'node:dns/promises';
import { connect, createServer, isIP, type Server, type Socket } from 'node:net';
import { pathToFileURL } from 'node:url';

/*
 * Egress enforcement for one bot's computer. This module is imported by the server and its tests, and it is
 * the entrypoint of the sidecar image (images/computer/egress.Dockerfile). It imports only Node built-ins, so
 * the image needs no install step and runs under Node's built-in type stripping.
 *
 * Topology: the computer sits on an `--internal` Docker network with no route out. The sidecar is its only
 * other member and also sits on the default bridge, which is the only route to the internet. The sidecar serves:
 * - a proxy (HTTP CONNECT to port 443, plain HTTP to port 80) for allowlisted names whose resolved addresses
 *   are all public. It connects to the address it validated and never resolves the name a second time.
 * - a relay on the Brot port to `internal`, so the computer reaches the Brot MCP endpoint and nothing else on
 *   the host.
 * Both listeners accept clients only from the internal network's subnet.
 */

export interface ResolvedAddress {
  address: string;
  family: number;
}

export interface EgressPolicyConfig {
  /** Allowed hostnames: exact names, or `*.name` for any depth of subdomain (not the apex). */
  allow: readonly string[];
  /** The single host:port exempt from the allowlist and the address checks: the Brot endpoint. */
  internal?: { host: string; port: number };
  /** CIDR of the internal network. Clients outside it are dropped. `null` accepts any client (tests only). */
  sourceCidr: string | null;
}

export interface EgressDeps {
  resolve?: (host: string) => Promise<ResolvedAddress[]>;
  dial?: (address: string, port: number) => Socket;
  onBlocked?: (host: string) => void;
  now?: () => number;
}

export interface EgressServer {
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/** Everything the sidecar needs. Passed as JSON in the BROT_EGRESS_CONFIG environment variable. */
export interface SidecarConfig {
  allow: string[];
  internal: { host: string; port: number };
  subnet: string;
  proxyPort: number;
}

const CONNECT_TIMEOUT_MS = 10_000;
const HEAD_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 300_000;
const MAX_HEAD_BYTES = 16_384;
const MAX_CONNECTIONS = 512;
const DEDUPE_MS = 60_000;
const MAX_BLOCKED_PER_MINUTE = 30;
const MAX_HOST_LENGTH = 253;

const REASONS: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  431: 'Request Header Fields Too Large',
  502: 'Bad Gateway',
};

const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '168.63.129.16/32',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];
const BLOCKED_V6 = ['::/96', '100::/64', '2001::/32', '2001:db8::/32', 'fc00::/7', 'fe80::/10', 'fec0::/10', 'ff00::/8'];

// 16-byte networks, compared with a prefix length, so they match only IPv6 addresses.
const MAPPED_V4_NET = Buffer.from('00000000000000000000ffff00000000', 'hex');
const NAT64_NET = Buffer.from('0064ff9b000000000000000000000000', 'hex');
const SIXTOFOUR_NET = Buffer.from('2002' + '0'.repeat(28), 'hex');

const LOOKUP_ALL = { all: true, verbatim: true } as const;

type Verdict = { ok: true; addresses: string[] } | { ok: false; status: number };
const REFUSED: Verdict = { ok: false, status: 403 };
const UNREACHABLE: Verdict = { ok: false, status: 502 };

/** Lowercases and drops one trailing dot, so `Example.COM.` and `example.com` compare equal. */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/** True when `host` (lowercase, normalized) matches an allowlist entry. Wildcards match subdomains only. */
export function hostAllowed(host: string, allow: readonly string[]): boolean {
  return allow.some((entry) => {
    if (!entry.startsWith('*.')) return host === entry;
    const suffix = entry.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  });
}

/** Returns the bytes of an IPv4 (4 bytes) or IPv6 (16 bytes) literal, or undefined when it is neither. */
function ipBytes(address: string): Buffer | undefined {
  const version = isIP(address.split('%')[0] ?? '');
  if (version === 4) return Buffer.from(address.split('.').map(Number));
  if (version === 6) return parseIPv6(address);
  return undefined;
}

function parseIPv6(input: string): Buffer | undefined {
  let text = input.split('%')[0] ?? '';
  const embedded = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded) {
    const quad = embedded[1] ?? '';
    const v4 = ipBytes(quad);
    if (v4 === undefined) return undefined;
    text = `${text.slice(0, text.length - quad.length)}${v4.readUInt16BE(0).toString(16)}:${v4.readUInt16BE(2).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' || halves[0] === undefined ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' && halves[1] !== undefined ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  const out = Buffer.alloc(16);
  for (const [index, group] of groups.entries()) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
    out.writeUInt16BE(Number.parseInt(group, 16), index * 2);
  }
  return out;
}

function inPrefix(address: Buffer, network: Buffer, bits: number): boolean {
  if (address.length !== network.length) return false;
  const whole = bits >> 3;
  for (let index = 0; index < whole; index++) {
    if (address[index] !== network[index]) return false;
  }
  const rest = bits & 7;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return ((address[whole] ?? 0) & mask) === ((network[whole] ?? 0) & mask);
}

/** Parses `address/bits` into the network bytes and prefix length. Throws on malformed input. */
export function parseCidr(text: string): [Buffer, number] {
  const [address = '', prefix = ''] = text.split('/');
  const bytes = ipBytes(address);
  if (bytes === undefined || !/^\d+$/.test(prefix) || Number(prefix) > bytes.length * 8) {
    throw new Error('invalid CIDR');
  }
  return [bytes, Number(prefix)];
}

const BLOCKED_V4_NETS = BLOCKED_V4.map(parseCidr);
const BLOCKED_V6_NETS = BLOCKED_V6.map(parseCidr);

function embeddedIPv4(bytes: Buffer): Buffer | undefined {
  if (inPrefix(bytes, MAPPED_V4_NET, 96) || inPrefix(bytes, NAT64_NET, 96)) return bytes.subarray(12);
  if (inPrefix(bytes, SIXTOFOUR_NET, 16)) return bytes.subarray(2, 6);
  return undefined;
}

function isPublicBytes(bytes: Buffer): boolean {
  if (bytes.length === 4) return !BLOCKED_V4_NETS.some(([net, bits]) => inPrefix(bytes, net, bits));
  const embedded = embeddedIPv4(bytes);
  if (embedded !== undefined) return isPublicBytes(embedded);
  return !BLOCKED_V6_NETS.some(([net, bits]) => inPrefix(bytes, net, bits));
}

/**
 * True for globally routable addresses. Loopback, private, link-local, CGNAT, multicast, reserved, documentation
 * and cloud metadata addresses are not public, including when they are embedded in IPv4-mapped, NAT64 or 6to4
 * IPv6 addresses. Anything that does not parse is not public.
 */
export function isPublicAddress(address: string): boolean {
  const bytes = ipBytes(address);
  return bytes !== undefined && isPublicBytes(bytes);
}

function unmapped(bytes: Buffer): Buffer {
  return bytes.length === 16 && inPrefix(bytes, MAPPED_V4_NET, 96) ? bytes.subarray(12) : bytes;
}

function sourceFilter(cidr: string | null): (address: string | undefined) => boolean {
  if (cidr === null) return () => true;
  const [network, bits] = parseCidr(cidr);
  return (address) => {
    const bytes = address === undefined ? undefined : ipBytes(address);
    return bytes !== undefined && inPrefix(unmapped(bytes), network, bits);
  };
}

/**
 * Drops repeated and excess refusal reports. Each host is reported at most once per minute, and at most
 * `MAX_BLOCKED_PER_MINUTE` reports go out per minute. Names that cannot be a `network.blocked` host are skipped.
 */
export function createBlockReporter(
  onBlocked: (host: string) => void,
  now: () => number = Date.now,
): (host: string) => void {
  const lastReported = new Map<string, number>();
  const sent: number[] = [];
  return (host) => {
    if (host.length === 0 || host.length > MAX_HOST_LENGTH || /[\s/?#@]/.test(host)) return;
    const at = now();
    const last = lastReported.get(host);
    if (last !== undefined && at - last < DEDUPE_MS) return;
    while (sent.length > 0 && at - (sent[0] ?? 0) >= 60_000) sent.shift();
    if (sent.length >= MAX_BLOCKED_PER_MINUTE) return;
    if (lastReported.size >= 1024) lastReported.clear();
    lastReported.set(host, at);
    sent.push(at);
    try {
      onBlocked(host);
    } catch {
      // A failing sink must not change what happens to the connection.
    }
  };
}

async function resolveAll(host: string): Promise<ResolvedAddress[]> {
  return lookup(host, LOOKUP_ALL);
}

function dialAddress(address: string, port: number): Socket {
  return connect({ host: address, port });
}

/** Connects to the first address that accepts. The addresses were already validated by the caller. */
async function openUpstream(
  addresses: readonly string[],
  port: number,
  dial: (address: string, port: number) => Socket,
): Promise<Socket | undefined> {
  for (const address of addresses) {
    const socket = await connectOnce(address, port, dial);
    if (socket !== undefined) return socket;
  }
  return undefined;
}

function connectOnce(
  address: string,
  port: number,
  dial: (address: string, port: number) => Socket,
): Promise<Socket | undefined> {
  return new Promise((settle) => {
    const socket = dial(address, port);
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.on('timeout', () => socket.destroy());
    socket.once('connect', () => {
      socket.setTimeout(0);
      settle(socket);
    });
    socket.once('error', () => {
      socket.destroy();
      settle(undefined);
    });
    socket.once('close', () => settle(undefined));
  });
}

/** Pipes two sockets together. Either side failing or going idle tears down both. */
function tunnel(a: Socket, b: Socket): void {
  const teardown = (): void => {
    a.destroy();
    b.destroy();
  };
  for (const socket of [a, b]) {
    socket.setTimeout(IDLE_TIMEOUT_MS);
    socket.on('timeout', teardown);
    socket.on('error', teardown);
    socket.on('close', teardown);
  }
  a.pipe(b);
  b.pipe(a);
}

function respond(socket: Socket, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${REASONS[status] ?? 'Error'}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

function makeServer(onConnection: (socket: Socket) => void): EgressServer {
  const sockets = new Set<Socket>();
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  server.maxConnections = MAX_CONNECTIONS;
  return {
    listen: (port, host) => listenOn(server, port, host),
    close: () =>
      new Promise((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}

function listenOn(server: Server, port: number, host?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => reject(error);
    server.once('error', failed);
    server.listen(port, host, () => {
      server.off('error', failed);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('listener has no port'));
        return;
      }
      resolve(address.port);
    });
  });
}

/**
 * The egress proxy. Handles HTTP CONNECT (port 443) and plain HTTP forwarding (port 80) to hosts on the
 * allowlist, plus the `internal` endpoint. Every refusal is reported through `onBlocked` (deduplicated) and
 * answered with a bare 403. Request bodies and headers are never logged or reported.
 */
export function createEgressProxy(config: EgressPolicyConfig, deps: EgressDeps = {}): EgressServer {
  const allow = config.allow.map((entry) => entry.toLowerCase());
  const internal = config.internal ? { host: normalizeHost(config.internal.host), port: config.internal.port } : undefined;
  const resolve = deps.resolve ?? resolveAll;
  const dial = deps.dial ?? dialAddress;
  const report = createBlockReporter(deps.onBlocked ?? (() => undefined), deps.now);
  const fromInternal = sourceFilter(config.sourceCidr);

  async function decide(host: string, port: number, scheme: 'connect' | 'http'): Promise<Verdict> {
    const exempt = internal !== undefined && host === internal.host && port === internal.port;
    if (!exempt) {
      const wantPort = scheme === 'connect' ? 443 : 80;
      if (port !== wantPort || !hostAllowed(host, allow)) {
        report(host);
        return REFUSED;
      }
    }
    let resolved: ResolvedAddress[];
    try {
      resolved = await resolve(host);
    } catch {
      return UNREACHABLE;
    }
    if (resolved.length === 0) return UNREACHABLE;
    if (!exempt && !resolved.every((entry) => isPublicAddress(entry.address))) {
      report(host);
      return REFUSED;
    }
    return { ok: true, addresses: resolved.map((entry) => entry.address) };
  }

  async function connectTunnel(client: Socket, target: string, rest: Buffer): Promise<void> {
    const match = /^(\[[^\]\s]+\]|[^\s:[\]]+):(\d{1,5})$/.exec(target);
    const port = Number(match?.[2]);
    if (match === null || !Number.isInteger(port) || port < 1 || port > 65535) return respond(client, 400);
    const host = normalizeHost((match[1] ?? '').replace(/^\[(.*)\]$/, '$1'));
    const verdict = await decide(host, port, 'connect');
    if (!verdict.ok) return respond(client, verdict.status);
    const upstream = await openUpstream(verdict.addresses, port, dial);
    if (upstream === undefined) return respond(client, 502);
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (rest.length > 0) upstream.write(rest);
    tunnel(client, upstream);
  }

  async function forward(client: Socket, method: string, target: string, headers: string[], rest: Buffer): Promise<void> {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return respond(client, 400);
    }
    if (!/^[A-Z]+$/.test(method) || url.protocol !== 'http:' || url.username !== '' || url.password !== '') {
      return respond(client, 400);
    }
    const host = normalizeHost(url.hostname.replace(/^\[(.*)\]$/, '$1'));
    const port = url.port === '' ? 80 : Number(url.port);
    const verdict = await decide(host, port, 'http');
    if (!verdict.ok) return respond(client, verdict.status);
    const upstream = await openUpstream(verdict.addresses, port, dial);
    if (upstream === undefined) return respond(client, 502);
    const kept = headers.filter((line) => !/^(proxy-connection|proxy-authorization|connection|keep-alive):/i.test(line));
    if (!kept.some((line) => /^host:/i.test(line))) kept.push(`Host: ${url.host}`);
    upstream.write(`${method} ${url.pathname}${url.search} HTTP/1.1\r\n${kept.join('\r\n')}\r\nConnection: close\r\n\r\n`);
    if (rest.length > 0) upstream.write(rest);
    tunnel(client, upstream);
  }

  async function handle(client: Socket, head: string, rest: Buffer): Promise<void> {
    const lines = head.split('\r\n');
    const parts = (lines[0] ?? '').split(' ');
    if (parts.length !== 3 || !/^HTTP\/1\.[01]$/.test(parts[2] ?? '')) return respond(client, 400);
    const [method = '', target = ''] = parts;
    if (method === 'CONNECT') return connectTunnel(client, target, rest);
    return forward(client, method, target, lines.slice(1), rest);
  }

  return makeServer((client) => {
    if (!fromInternal(client.remoteAddress)) {
      client.destroy();
      return;
    }
    client.setTimeout(HEAD_TIMEOUT_MS);
    client.on('timeout', () => client.destroy());
    client.on('error', () => client.destroy());
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buffered.length > MAX_HEAD_BYTES) {
          client.removeListener('data', onData);
          client.pause();
          respond(client, 431);
        }
        return;
      }
      client.removeListener('data', onData);
      client.pause();
      client.setTimeout(0);
      const head = buffered.subarray(0, end).toString('latin1');
      const rest = buffered.subarray(end + 4);
      handle(client, head, rest).catch(() => client.destroy());
    };
    client.on('data', onData);
  });
}

/**
 * The Brot endpoint relay. Forwards every connection to `target` and nothing else. The computer reaches the
 * Brot MCP server through it without a route to the host.
 */
export function createRelay(
  target: { host: string; port: number },
  config: { sourceCidr: string | null },
  deps: EgressDeps = {},
): EgressServer {
  const resolve = deps.resolve ?? resolveAll;
  const dial = deps.dial ?? dialAddress;
  const fromInternal = sourceFilter(config.sourceCidr);
  const host = normalizeHost(target.host);
  return makeServer((client) => {
    if (!fromInternal(client.remoteAddress)) {
      client.destroy();
      return;
    }
    client.on('error', () => client.destroy());
    resolve(host)
      .then((resolved) => openUpstream(resolved.map((entry) => entry.address), target.port, dial))
      .then((upstream) => {
        if (upstream === undefined) client.destroy();
        else tunnel(client, upstream);
      })
      .catch(() => client.destroy());
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPort = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;

/** Same shape as the server's EgressHost: lowercase labels, at least two, and a top-level label with a letter. */
function isAllowEntry(entry: string): boolean {
  if (entry.length > MAX_HOST_LENGTH) return false;
  const name = entry.startsWith('*.') ? entry.slice(2) : entry;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return false;
  return /[a-z]/.test(name.split('.').pop() ?? '');
}

/** Validates the sidecar's configuration. Throws with a message that never echoes the configuration. */
export function parseSidecarConfig(raw: string | undefined): SidecarConfig {
  if (raw === undefined || raw === '') throw new Error('BROT_EGRESS_CONFIG is required');
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) throw new Error('BROT_EGRESS_CONFIG must be a JSON object');
  const allow: string[] = [];
  if (!Array.isArray(value.allow)) throw new Error('allow must be a list of hostnames');
  for (const entry of value.allow as unknown[]) {
    if (typeof entry !== 'string' || !isAllowEntry(entry)) throw new Error('allow contains an invalid hostname');
    allow.push(entry);
  }
  const internal = value.internal;
  if (!isRecord(internal) || typeof internal.host !== 'string' || !isPort(internal.port)) {
    throw new Error('internal must be { host, port }');
  }
  if (typeof value.subnet !== 'string') throw new Error('subnet must be a CIDR string');
  parseCidr(value.subnet);
  if (!isPort(value.proxyPort)) throw new Error('proxyPort must be a port number');
  return {
    allow,
    internal: { host: internal.host, port: internal.port },
    subnet: value.subnet,
    proxyPort: value.proxyPort,
  };
}

/**
 * Runs the sidecar: the proxy and the Brot relay, both limited to the internal subnet. Each refused host is
 * written to stdout as one JSON line, which the server reads through `docker logs`.
 */
export async function runSidecar(
  env: NodeJS.ProcessEnv,
  write: (line: string) => void = (line) => process.stdout.write(line),
): Promise<() => Promise<void>> {
  const config = parseSidecarConfig(env.BROT_EGRESS_CONFIG);
  const onBlocked = (host: string): void => write(`${JSON.stringify({ brot: 'blocked', host })}\n`);
  const proxy = createEgressProxy({ allow: config.allow, internal: config.internal, sourceCidr: config.subnet }, { onBlocked });
  const relay = createRelay(config.internal, { sourceCidr: config.subnet });
  await proxy.listen(config.proxyPort);
  await relay.listen(config.internal.port);
  process.stderr.write('egress sidecar ready\n');
  return async () => {
    await Promise.all([proxy.close(), relay.close()]);
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSidecar(process.env)
    .then((stop) => {
      const shutdown = (): void => {
        stop().finally(() => process.exit(0));
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    })
    .catch((error: unknown) => {
      process.stderr.write(`egress sidecar failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
      process.exitCode = 1;
    });
}
