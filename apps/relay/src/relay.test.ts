import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { startRelay, type RelayHandle, type RelayOptions } from './relay';

const handles: RelayHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const handle of handles.splice(0)) await handle.close();
});

async function start(options: RelayOptions = {}): Promise<RelayHandle> {
  const handle = await startRelay({ host: '127.0.0.1', port: 0, ...options });
  handles.push(handle);
  return handle;
}

function channelId(): string {
  return randomBytes(16).toString('base64url');
}

function urlFor(relay: RelayHandle, id: string): string {
  return `ws://127.0.0.1:${relay.port}/channels/${id}`;
}

interface Peer {
  ws: WebSocket;
  closed: Promise<{ code: number; reason: string }>;
}

function connect(url: string): Promise<Peer> {
  const ws = new WebSocket(url);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });
  ws.on('error', () => undefined);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, closed }));
    ws.once('error', reject);
  });
}

function toBuffer(data: RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
}

function nextMessage(ws: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  return new Promise((resolve) => {
    ws.once('message', (data: RawData, isBinary: boolean) => resolve({ data: toBuffer(data), isBinary }));
  });
}

describe('startRelay', () => {
  it('forwards binary and text frames between two peers byte for byte', async () => {
    const relay = await start();
    const id = channelId();
    const a = await connect(urlFor(relay, id));
    const b = await connect(urlFor(relay, id));

    const sealed = randomBytes(64 * 1024);
    const toB = nextMessage(b.ws);
    a.ws.send(sealed, { binary: true });
    const received = await toB;
    expect(received.isBinary).toBe(true);
    expect(received.data.equals(sealed)).toBe(true);

    const text = 'olá, Brötchen 🥐';
    const toA = nextMessage(a.ws);
    b.ws.send(text, { binary: false });
    const reply = await toA;
    expect(reply.isBinary).toBe(false);
    expect(reply.data.toString('utf8')).toBe(text);
  });

  it('rejects a third client on the same channel', async () => {
    const relay = await start();
    const id = channelId();
    await connect(urlFor(relay, id));
    await connect(urlFor(relay, id));

    await expect(connect(urlFor(relay, id))).rejects.toThrow(/409/);
  });

  it('closes the sender when a frame exceeds the size limit and drops the channel', async () => {
    const relay = await start({ maxFrameBytes: 1024 });
    const id = channelId();
    const a = await connect(urlFor(relay, id));
    const b = await connect(urlFor(relay, id));
    const bGoesAway = b.closed;

    a.ws.send(Buffer.alloc(2048, 1), { binary: true });

    expect((await a.closed).code).toBe(1009);
    expect(await bGoesAway).toEqual({ code: 1000, reason: 'peer left' });
  });

  it('drops the channel when a peer leaves, so the id can be reused', async () => {
    const relay = await start();
    const id = channelId();
    const a = await connect(urlFor(relay, id));
    const b = await connect(urlFor(relay, id));

    a.ws.close();
    expect(await b.closed).toEqual({ code: 1000, reason: 'peer left' });

    const c = await connect(urlFor(relay, id));
    const d = await connect(urlFor(relay, id));
    const toD = nextMessage(d.ws);
    c.ws.send('hello', { binary: false });
    expect((await toD).data.toString('utf8')).toBe('hello');
  });

  it('drops a channel that carries no frames for the idle timeout, and frames keep it alive', async () => {
    const relay = await start({ idleTimeoutMs: 150 });
    const id = channelId();
    const a = await connect(urlFor(relay, id));
    const b = await connect(urlFor(relay, id));

    for (let i = 0; i < 5; i += 1) {
      const received = nextMessage(b.ws);
      a.ws.send('tick', { binary: false });
      await received;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(a.ws.readyState).toBe(WebSocket.OPEN);

    expect(await a.closed).toEqual({ code: 1000, reason: 'idle timeout' });
    expect(await b.closed).toEqual({ code: 1000, reason: 'idle timeout' });
  });

  it('refuses paths that are not a channel URL', async () => {
    const relay = await start();
    const id = channelId();

    await expect(connect(`ws://127.0.0.1:${relay.port}/channels/short`)).rejects.toThrow(/404/);
    await expect(connect(`ws://127.0.0.1:${relay.port}/other/${id}`)).rejects.toThrow(/404/);
  });

  it('answers the health check', async () => {
    const relay = await start();
    const response = await fetch(`http://127.0.0.1:${relay.port}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('never writes payloads to the console', async () => {
    const relay = await start();
    const id = channelId();
    const a = await connect(urlFor(relay, id));
    const b = await connect(urlFor(relay, id));
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];

    const received = nextMessage(b.ws);
    a.ws.send('plaintext-that-must-not-appear', { binary: false });
    await received;
    a.ws.send(Buffer.alloc(4, 0xff), { binary: true });
    await nextMessage(b.ws);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('stops accepting connections after close', async () => {
    const relay = await startRelay({ host: '127.0.0.1', port: 0 });
    const url = urlFor(relay, channelId());
    await relay.close();

    await expect(connect(url)).rejects.toThrow();
  });
});
