import { CanonicalEvent } from '@brot/protocol';
import type { OpenStream, StreamConnection } from './sse';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'unauthorized';

export interface LiveTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface LiveEventsOptions {
  /** Builds the stream request; `after` is the newest event timestamp already delivered. */
  request: (after: string | undefined) => { url: string; headers: Record<string, string> };
  open: OpenStream;
  timers?: LiveTimers;
  /** Backoff bounds in ms. */
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface LiveEvents {
  start(): void;
  stop(): void;
  /** Reconnects now, skipping any pending backoff. Used when the app returns to the foreground. */
  reconnect(): void;
  subscribe(listener: (event: CanonicalEvent) => void): () => void;
  onStatus(listener: (status: LiveStatus) => void): () => void;
  readonly status: LiveStatus;
  /** Timestamp of the newest delivered event, used to resume after a drop. */
  readonly lastEventAt: string | undefined;
}

const DEDUPE_WINDOW = 1000;

/**
 * One shared connection to /api/events. It resumes with `after` on reconnect, and since a replay
 * may repeat events that share the cursor's timestamp, delivery is de-duplicated by event id.
 * A 401 or 403 stops it for good: the device token was revoked.
 */
export function createLiveEvents({
  request,
  open,
  timers = { setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms), clearTimeout: (h) => globalThis.clearTimeout(h as number) },
  minDelayMs = 1000,
  maxDelayMs = 30_000,
}: LiveEventsOptions): LiveEvents {
  const listeners = new Set<(event: CanonicalEvent) => void>();
  const statusListeners = new Set<(status: LiveStatus) => void>();
  const seen = new Set<string>();
  const order: string[] = [];
  let status: LiveStatus = 'idle';
  let connection: StreamConnection | undefined;
  let generation = 0;
  let retry: unknown = null;
  let attempts = 0;
  let lastAt: string | undefined;
  let running = false;

  const setStatus = (next: LiveStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of [...statusListeners]) listener(next);
  };

  const remember = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    order.push(id);
    if (order.length > DEDUPE_WINDOW) seen.delete(order.shift()!);
    return true;
  };

  const deliver = (data: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = CanonicalEvent.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (!remember(event.id)) return;
    if (lastAt === undefined || Date.parse(event.at) >= Date.parse(lastAt)) lastAt = event.at;
    for (const listener of [...listeners]) listener(event);
  };

  const clearRetry = () => {
    if (retry !== null) timers.clearTimeout(retry);
    retry = null;
  };

  const connect = () => {
    clearRetry();
    generation += 1;
    const mine = generation;
    connection?.close();
    setStatus(attempts === 0 ? 'connecting' : 'reconnecting');
    connection = open(request(lastAt), {
      onOpen() {
        if (mine !== generation) return;
        attempts = 0;
        setStatus('live');
      },
      onFrame(frame) {
        if (mine === generation) deliver(frame.data);
      },
      onClose(code) {
        if (mine !== generation) return;
        generation += 1;
        connection = undefined;
        if (!running) return;
        if (code === 401 || code === 403) {
          running = false;
          setStatus('unauthorized');
          return;
        }
        attempts += 1;
        setStatus('reconnecting');
        const delay = Math.min(maxDelayMs, minDelayMs * 2 ** Math.min(attempts - 1, 10));
        retry = timers.setTimeout(connect, delay);
      },
    });
    if (mine !== generation) connection = undefined;
  };

  return {
    start() {
      if (running) return;
      running = true;
      attempts = 0;
      connect();
    },
    stop() {
      running = false;
      clearRetry();
      generation += 1;
      const current = connection;
      connection = undefined;
      current?.close();
      setStatus('idle');
    },
    reconnect() {
      if (!running) return;
      connect();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    get status() {
      return status;
    },
    get lastEventAt() {
      return lastAt;
    },
  };
}
