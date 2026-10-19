import { describe, expect, it } from 'vitest';
import type { CanonicalEvent } from '@brot/protocol';
import { createLiveEvents, type LiveStatus } from './liveEvents';
import type { StreamHandlers } from './sse';
import { at } from '../testing';

function harness() {
  const opened: { after: string | undefined; handlers: StreamHandlers; closed: boolean }[] = [];
  const pending: { cb: () => void; ms: number }[] = [];
  const statuses: LiveStatus[] = [];
  const events: CanonicalEvent[] = [];
  let lastAfter: string | undefined;
  const live = createLiveEvents({
    request: (after) => {
      lastAfter = after;
      return { url: `u?after=${after ?? ''}`, headers: {} };
    },
    open: (_req, handlers) => {
      const entry = { after: lastAfter, handlers, closed: false };
      opened.push(entry);
      return { close: () => void (entry.closed = true) };
    },
    timers: {
      setTimeout: (cb, ms) => {
        const item = { cb, ms };
        pending.push(item);
        return item;
      },
      clearTimeout: (handle) => {
        const index = pending.indexOf(handle as (typeof pending)[number]);
        if (index >= 0) pending.splice(index, 1);
      },
    },
  });
  live.onStatus((s) => statuses.push(s));
  live.subscribe((e) => events.push(e));
  const frame = (id: string, seconds: number) =>
    JSON.stringify({ id, at: at(seconds), threadId: 'th1', type: 'run.completed', runId: 'r1' });
  return { live, opened, pending, statuses, events, frame };
}

describe('createLiveEvents', () => {
  it('delivers valid events once and drops malformed frames', () => {
    const h = harness();
    h.live.start();
    const conn = h.opened[0]!;
    conn.handlers.onOpen();
    conn.handlers.onFrame({ event: 'run.completed', data: h.frame('e1', 1) });
    conn.handlers.onFrame({ event: 'run.completed', data: h.frame('e1', 1) });
    conn.handlers.onFrame({ event: 'x', data: 'not json' });
    conn.handlers.onFrame({ event: 'x', data: JSON.stringify({ id: 'e2', type: 'nope' }) });
    expect(h.events.map((e) => e.id)).toEqual(['e1']);
    expect(h.statuses).toEqual(['connecting', 'live']);
  });

  it('reconnects with backoff and resumes after the newest event', () => {
    const h = harness();
    h.live.start();
    h.opened[0]!.handlers.onOpen();
    h.opened[0]!.handlers.onFrame({ event: 'm', data: h.frame('e1', 5) });
    h.opened[0]!.handlers.onClose(0);
    expect(h.live.status).toBe('reconnecting');
    expect(h.pending[0]?.ms).toBe(1000);
    h.pending.shift()!.cb();
    expect(h.opened[1]?.after).toBe(at(5));
    h.opened[1]!.handlers.onClose(0);
    expect(h.pending[0]?.ms).toBe(2000);
  });

  it('ignores a replayed event it already delivered', () => {
    const h = harness();
    h.live.start();
    h.opened[0]!.handlers.onFrame({ event: 'm', data: h.frame('e1', 5) });
    h.opened[0]!.handlers.onClose(0);
    h.pending.shift()!.cb();
    h.opened[1]!.handlers.onFrame({ event: 'm', data: h.frame('e1', 5) });
    h.opened[1]!.handlers.onFrame({ event: 'm', data: h.frame('e2', 5) });
    expect(h.events.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('stops for good when the token is rejected', () => {
    const h = harness();
    h.live.start();
    h.opened[0]!.handlers.onClose(401);
    expect(h.live.status).toBe('unauthorized');
    expect(h.pending).toHaveLength(0);
  });

  it('closes the connection on stop and ignores its late callbacks', () => {
    const h = harness();
    h.live.start();
    const first = h.opened[0]!;
    h.live.stop();
    expect(first.closed).toBe(true);
    first.handlers.onFrame({ event: 'm', data: h.frame('late', 9) });
    first.handlers.onClose(0);
    expect(h.events).toHaveLength(0);
    expect(h.pending).toHaveLength(0);
    expect(h.live.status).toBe('idle');
  });

  it('reconnect replaces the current connection immediately', () => {
    const h = harness();
    h.live.start();
    h.opened[0]!.handlers.onClose(0);
    h.live.reconnect();
    expect(h.pending).toHaveLength(0);
    expect(h.opened).toHaveLength(2);
  });
});
