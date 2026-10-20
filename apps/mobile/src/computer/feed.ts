import type { ScreenFrame } from '../api/client';

export type FeedStatus = 'loading' | 'live' | 'stopped' | 'none' | 'error';

export interface FeedTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

export interface ScreenFeedOptions {
  fetchFrame: () => Promise<ScreenFrame>;
  onFrame: (uri: string) => void;
  onStatus: (status: FeedStatus) => void;
  /** Time between frame starts while live: 500 ms is about 2 fps. */
  intervalMs?: number;
  /** Wait before asking again when the computer is off or unreachable. */
  idleMs?: number;
  timers?: FeedTimers;
}

export interface ScreenFeed {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/**
 * Polls the live screen one frame at a time: the next request starts only after the previous one
 * finishes, at most every `intervalMs`, so a slow link lowers the frame rate instead of piling up
 * requests. A bot without a desktop stops the feed; an off or unreachable computer slows it down.
 */
export function createScreenFeed({
  fetchFrame,
  onFrame,
  onStatus,
  intervalMs = 500,
  idleMs = 2500,
  timers = {
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h as number),
    now: () => Date.now(),
  },
}: ScreenFeedOptions): ScreenFeed {
  let running = false;
  let generation = 0;
  let timer: unknown = null;
  let status: FeedStatus | undefined;

  const setStatus = (next: FeedStatus) => {
    if (next === status) return;
    status = next;
    onStatus(next);
  };

  const schedule = (mine: number, ms: number) => {
    timer = timers.setTimeout(() => {
      timer = null;
      void tick(mine);
    }, Math.max(0, ms));
  };

  const tick = async (mine: number) => {
    const started = timers.now();
    let wait = intervalMs;
    try {
      const frame = await fetchFrame();
      if (mine !== generation) return;
      if (frame.kind === 'frame') {
        onFrame(frame.uri);
        setStatus('live');
      } else if (frame.kind === 'stopped') {
        setStatus('stopped');
        wait = idleMs;
      } else {
        setStatus('none');
        running = false;
        return;
      }
    } catch {
      if (mine !== generation) return;
      setStatus('error');
      wait = idleMs;
    }
    schedule(mine, wait - (timers.now() - started));
  };

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      if (status === undefined) setStatus('loading');
      void tick(generation);
    },
    stop() {
      running = false;
      generation += 1;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    },
    get running() {
      return running;
    },
  };
}
