import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlinkScheduler } from './blink';

describe('createBlinkScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts at a random phase, then blinks at gaps inside the range', () => {
    const onBlink = vi.fn();
    const scheduler = createBlinkScheduler({ minMs: 3000, maxMs: 7000, onBlink, random: () => 0.5 });
    scheduler.start();
    expect(scheduler.running).toBe(true);

    vi.advanceTimersByTime(2499);
    expect(onBlink).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBlink).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(onBlink).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(onBlink).toHaveBeenCalledTimes(3);
  });

  it('never blinks faster than minMs or slower than maxMs', () => {
    const times: number[] = [];
    let flip = false;
    const scheduler = createBlinkScheduler({
      minMs: 3000,
      maxMs: 7000,
      onBlink: () => times.push(Date.now()),
      random: () => {
        flip = !flip;
        return flip ? 0 : 0.999;
      },
    });
    scheduler.start();
    vi.advanceTimersByTime(60_000);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(gaps.length).toBeGreaterThan(5);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(3000);
      expect(gap).toBeLessThan(7000);
    }
  });

  it('stops cleanly and can restart', () => {
    const onBlink = vi.fn();
    const scheduler = createBlinkScheduler({ minMs: 1000, maxMs: 1000, onBlink, random: () => 0.9 });
    scheduler.start();
    scheduler.start();
    scheduler.stop();
    expect(scheduler.running).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(onBlink).not.toHaveBeenCalled();
    scheduler.start();
    vi.advanceTimersByTime(900);
    expect(onBlink).toHaveBeenCalledTimes(1);
  });

  it('desyncs avatars that start together', () => {
    const first = vi.fn();
    const second = vi.fn();
    createBlinkScheduler({ minMs: 3000, maxMs: 7000, onBlink: first, random: () => 0.1 }).start();
    createBlinkScheduler({ minMs: 3000, maxMs: 7000, onBlink: second, random: () => 0.8 }).start();
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
