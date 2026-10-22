import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { botAllowlist, createBotEgress, hostAllowedForBot, type BotEgress } from './egress';
import { botFor } from './test-helpers';

const egressServers: BotEgress[] = [];
const localServers: Server[] = [];

afterEach(async () => {
  await Promise.all(egressServers.splice(0).map((egress) => egress.close()));
  await Promise.all(
    localServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function startEgress(allow: readonly string[] | undefined, onBlocked?: (host: string) => void): Promise<BotEgress> {
  const egress = await createBotEgress(botFor('bot_1', allow), onBlocked);
  egressServers.push(egress);
  return egress;
}

/** Sends one raw request to the proxy and reads its answer. The proxy answers refusals with a bare 403 and closes. */
function proxyAnswer(port: number, head: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let answer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('the proxy did not answer'));
    }, 5_000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.end(head));
    socket.on('data', (chunk: string) => {
      answer += chunk;
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(answer);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function localServer(): Promise<{ server: Server; port: number; hits: () => number }> {
  const server = createServer((_request, response) => {
    hits += 1;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('LOOPBACK_MARKER');
  });
  let hits = 0;
  localServers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address !== null ? address.port : 0, hits: () => hits });
    });
  });
}

describe('botAllowlist', () => {
  it('uses the allowlist only when the policy mode is allowlist', () => {
    expect(botAllowlist(botFor('bot_1', ['example.com']))).toEqual(['example.com']);
    expect(botAllowlist(botFor('bot_1'))).toEqual([]);
    expect(botAllowlist({ ...botFor('bot_1'), egress: undefined })).toEqual([]);
  });
});

describe('hostAllowedForBot', () => {
  it('matches exact entries and wildcard subdomains', () => {
    const bot = botFor('bot_1', ['example.com', '*.example.org']);
    expect(hostAllowedForBot(bot, 'example.com')).toBe(true);
    expect(hostAllowedForBot(bot, 'EXAMPLE.com.')).toBe(true);
    expect(hostAllowedForBot(bot, 'api.example.org')).toBe(true);
    expect(hostAllowedForBot(bot, 'example.org')).toBe(false);
    expect(hostAllowedForBot(bot, 'www.google.com')).toBe(false);
  });

  it('allows nothing for a deny-all bot', () => {
    const bot = botFor('bot_1');
    expect(hostAllowedForBot(bot, 'example.com')).toBe(false);
  });
});

describe('createBotEgress', () => {
  it('refuses a host outside the allowlist and reports it once', async () => {
    const blocked: string[] = [];
    const egress = await startEgress(['example.com'], (host) => blocked.push(host));
    const answer = await proxyAnswer(egress.port, 'CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\n\r\n');
    expect(answer).toMatch(/^HTTP\/1\.1 403 Forbidden/);
    expect(blocked).toEqual(['www.google.com']);
  });

  it('refuses everything for a deny-all bot', async () => {
    const egress = await startEgress(undefined);
    const answer = await proxyAnswer(egress.port, 'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
    expect(answer).toMatch(/^HTTP\/1\.1 403 Forbidden/);
  });

  it('refuses loopback even when a server is listening there', async () => {
    const local = await localServer();
    const egress = await startEgress(['example.com']);
    const answer = await proxyAnswer(
      egress.port,
      `GET http://127.0.0.1:${local.port}/ HTTP/1.1\r\nHost: 127.0.0.1:${local.port}\r\n\r\n`,
    );
    expect(answer).toMatch(/^HTTP\/1\.1 403 Forbidden/);
    expect(local.hits()).toBe(0);
  });

  it('refuses an allowlisted name that resolves to a private address', async () => {
    // A stored policy cannot contain `localhost` (the bot schema rejects it); the proxy still has to catch it.
    const blocked: string[] = [];
    const egress = await startEgress(['localhost'], (host) => blocked.push(host));
    const answer = await proxyAnswer(egress.port, 'CONNECT localhost:443 HTTP/1.1\r\nHost: localhost:443\r\n\r\n');
    expect(answer).toMatch(/^HTTP\/1\.1 403 Forbidden/);
    expect(blocked).toEqual(['localhost']);
  });

  it('closes idempotently', async () => {
    const egress = await createBotEgress(botFor('bot_1'));
    await egress.close();
    await egress.close();
  });
});
