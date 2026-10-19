export interface BlinkTimers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface BlinkSchedulerOptions {
  /** Inclusive lower bound of the gap between blinks, in ms. */
  minMs: number;
  /** Upper bound of the gap between blinks, in ms. */
  maxMs: number;
  onBlink: () => void;
  /** Returns a number in [0, 1). Defaults to Math.random. */
  random?: () => number;
  timers?: BlinkTimers;
}

export interface BlinkScheduler {
  start: () => void;
  stop: () => void;
  readonly running: boolean;
}

/**
 * Fires onBlink at random gaps in [minMs, maxMs). The first gap is a random fraction of a full gap,
 * so avatars mounted together start out of phase and never blink in sync.
 */
export function createBlinkScheduler({
  minMs,
  maxMs,
  onBlink,
  random = Math.random,
  timers = { setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms), clearTimeout: (h) => globalThis.clearTimeout(h as number) },
}: BlinkSchedulerOptions): BlinkScheduler {
  let handle: unknown = null;
  const gap = () => minMs + random() * (maxMs - minMs);

  const schedule = (ms: number) => {
    handle = timers.setTimeout(() => {
      onBlink();
      schedule(gap());
    }, ms);
  };

  return {
    start() {
      if (handle !== null) return;
      schedule(random() * gap());
    },
    stop() {
      if (handle === null) return;
      timers.clearTimeout(handle);
      handle = null;
    },
    get running() {
      return handle !== null;
    },
  };
}
