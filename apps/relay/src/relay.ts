import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

export const DEFAULT_RELAY_PORT = 8787;
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
/** A peer that falls this far behind is disconnected instead of letting the relay buffer without bound. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_PEERS_PER_CHANNEL = 2;
const CHANNEL_PATH = /^\/channels\/([A-Za-z0-9_-]{16,128})$/;

export interface RelayOptions {
  /** Interface to bind. Defaults to 127.0.0.1. */
  host?: string;
  /** Port to bind. 0 picks a free port. Defaults to 8787. */
  port?: number;
  /** Largest frame a peer may send. A larger frame closes that peer's connection. Defaults to 1 MiB. */
  maxFrameBytes?: number;
  /** A channel that carries no frames for this long is dropped. Defaults to 5 minutes. */
  idleTimeoutMs?: number;
}

export interface RelayHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

interface Channel {
  id: string;
  peers: Set<WebSocket>;
  idleTimer?: NodeJS.Timeout;
}

/**
 * Starts a blind forwarder. Peers connect to `/channels/<id>`, and the two peers on one channel exchange
 * frames verbatim. The relay never parses or logs payloads, so it holds no plaintext.
 */
export function startRelay(options: RelayOptions = {}): Promise<RelayHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? DEFAULT_RELAY_PORT;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const channels = new Map<string, Channel>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES,
    perMessageDeflate: false,
  });

  const http: Server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    response.writeHead(404).end();
  });

  http.on('upgrade', (request, socket, head) => {
    socket.on('error', () => undefined);
    const id = channelIdOf(request.url);
    if (id === undefined) {
      refuse(socket, 404, 'Not Found');
      return;
    }
    if ((channels.get(id)?.peers.size ?? 0) >= MAX_PEERS_PER_CHANNEL) {
      refuse(socket, 409, 'Conflict');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => join(id, ws));
  });

  function join(id: string, ws: WebSocket): void {
    const channel = channels.get(id) ?? { id, peers: new Set<WebSocket>() };
    channels.set(id, channel);
    if (channel.peers.size >= MAX_PEERS_PER_CHANNEL) {
      ws.close(1013, 'channel full');
      return;
    }
    channel.peers.add(ws);
    touch(channel);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      touch(channel);
      for (const peer of channel.peers) {
        if (peer === ws || peer.readyState !== WebSocket.OPEN) continue;
        if (peer.bufferedAmount > MAX_BUFFERED_BYTES) {
          peer.close(1008, 'backpressure');
          continue;
        }
        peer.send(data, { binary: isBinary });
      }
    });
    // An oversized frame raises an error and then a close. Neither is logged, since logs must not describe traffic.
    ws.on('error', () => undefined);
    ws.on('close', () => leave(channel, ws));
  }

  function leave(channel: Channel, ws: WebSocket): void {
    if (!channel.peers.delete(ws)) return;
    drop(channel, 'peer left');
  }

  function touch(channel: Channel): void {
    if (channels.get(channel.id) !== channel) return;
    clearTimeout(channel.idleTimer);
    channel.idleTimer = setTimeout(() => drop(channel, 'idle timeout'), idleTimeoutMs);
  }

  function drop(channel: Channel, reason: string): void {
    clearTimeout(channel.idleTimer);
    const peers = [...channel.peers];
    channel.peers.clear();
    if (channels.get(channel.id) === channel) channels.delete(channel.id);
    for (const peer of peers) peer.close(1000, reason);
  }

  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      for (const channel of channels.values()) {
        clearTimeout(channel.idleTimer);
        for (const peer of channel.peers) peer.terminate();
      }
      channels.clear();
      wss.close();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
      });
    })();
    return closing;
  }

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => {
      http.off('error', reject);
      const address = http.address() as AddressInfo;
      resolve({ host, port: address.port, close });
    });
  });
}

function channelIdOf(url: string | undefined): string | undefined {
  const path = (url ?? '').split('?', 1)[0] ?? '';
  return CHANNEL_PATH.exec(path)?.[1];
}

function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
