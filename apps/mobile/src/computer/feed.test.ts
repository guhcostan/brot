import { describe, expect, it } from 'vitest';
import type { ScreenFrame } from '../api/client';
import { createScreenFeed, type FeedStatus } from './feed';

function harness(frames: (ScreenFrame | Error)[]) {
  let now = 0;
  const pending: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  const fetched: number[] = [];
  const shown: string[] = [];
  const statuses: FeedStatus[] = [];
  const feed = createScreenFeed({
    fetchFrame: async () => {
      fetched.push(now);
      const next = frames.shift() ?? { kind: 'frame', uri: 'data:last' };
      if (next instanceof Error) throw next;
      return next;
    },
    onFrame: (uri) => shown.push(uri),
    onStatus: (status) => statuses.push(status),
    timers: {
      setTimeout: (run, ms) => {
        ids += 1;
        pending.push({ at: now + ms, run, id: ids });
        return ids;
      },
      clearTimeout: (id) => {
        const index = pending.findIndex((entry) => entry.id === id);
        if (index >= 0) pending.splice(index, 1);
      },
      now: () => now,
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      await flush();
      pending.sort((a, b) => a.at - b.at);
      const next = pending[0];
      if (!next || next.at > until) break;
      pending.shift();
      now = next.at;
      next.run();
    }
    now = until;
    await flush();
  };
  return { feed, fetched, shown, statuses, advance, pending };
}

describe('screen feed', () => {
  it('polls about twice a second while running and stops cleanly', async () => {
    const h = harness([]);
    h.feed.start();
    await h.advance(1600);
    expect(h.fetched).toEqual([0, 500, 1000, 1500]);
    expect(h.statuses).toEqual(['loading', 'live']);
    h.feed.stop();
    await h.advance(2000);
    expect(h.fetched).toHaveLength(4);
    expect(h.pending).toHaveLength(0);
  });

  it('slows down while the computer is off and recovers', async () => {
    const h = harness([{ kind: 'stopped' }, { kind: 'frame', uri: 'data:a' }]);
    h.feed.start();
    await h.advance(2600);
    expect(h.fetched.slice(0, 2)).toEqual([0, 2500]);
    expect(h.statuses).toEqual(['loading', 'stopped', 'live']);
    expect(h.shown[0]).toBe('data:a');
    h.feed.stop();
  });

  it('gives up on a bot without a desktop and backs off on errors', async () => {
    const none = harness([{ kind: 'none' }]);
    none.feed.start();
    await none.advance(3000);
    expect(none.fetched).toEqual([0]);
    expect(none.feed.running).toBe(false);

    const failing = harness([new Error('offline')]);
    failing.feed.start();
    await failing.advance(100);
    expect(failing.statuses.at(-1)).toBe('error');
    failing.feed.stop();
  });
});
