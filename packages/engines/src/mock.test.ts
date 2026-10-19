import type { EngineEvent } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createMockEngine } from './mock';
import { collect, makeContext } from './test-utils';

describe('mock engine', () => {
  it('reports itself as available with one model', async () => {
    const driver = createMockEngine();
    expect(driver.id).toBe('mock');
    expect(await driver.detect()).toEqual({ available: true });
    expect(await driver.models()).toEqual([{ id: 'mock-1', label: 'Mock' }]);
  });

  it('echoes the input as several text deltas, then reports usage', async () => {
    const { ctx } = makeContext({ input: 'hello there' });
    const events = await collect(createMockEngine().run(ctx));

    const deltas = events.filter((e) => e.type === 'text.delta');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e) => (e.type === 'text.delta' ? e.delta : '')).join('')).toBe('You said: hello there');
    expect(events.at(-1)).toEqual({ type: 'usage', tokensIn: 2, tokensOut: 4, costUsd: 0 });
  });

  it('runs a /tool command through the broker and emits the call and an ok result when allowed', async () => {
    const { ctx, requests } = makeContext({ input: '/tool shell ls -la' });
    const events = await collect(createMockEngine().run(ctx));

    expect(requests).toEqual([
      {
        callId: 'run_1:tool:0',
        tool: 'shell',
        kind: 'shell',
        summary: 'ls -la',
        args: { command: 'ls -la' },
      },
    ]);
    expect(events.slice(0, 2)).toEqual([
      { type: 'tool.call', callId: 'run_1:tool:0', tool: 'shell', args: { command: 'ls -la' } },
      { type: 'tool.result', callId: 'run_1:tool:0', ok: true, output: 'ok' },
    ]);
  });

  it('keeps the shell command exactly as typed', async () => {
    const { ctx, requests } = makeContext({ input: '/tool shell echo  "a   b"' });
    await collect(createMockEngine().run(ctx));
    expect(requests[0]).toMatchObject({ args: { command: 'echo  "a   b"' }, summary: 'echo  "a   b"' });
  });

  it('reports a denied tool with the user reply and no text output', async () => {
    const { ctx } = makeContext({
      input: '/tool shell rm -rf build',
      decide: () => ({ allowed: false, reply: 'use trash instead' }),
    });
    const events = await collect(createMockEngine().run(ctx));

    expect(events.slice(0, 2)).toEqual([
      { type: 'tool.call', callId: 'run_1:tool:0', tool: 'shell', args: { command: 'rm -rf build' } },
      { type: 'tool.result', callId: 'run_1:tool:0', ok: false, output: 'denied by user: use trash instead' },
    ]);
    expect(events.some((e) => e.type === 'text.delta')).toBe(false);
  });

  it('reports a denied tool without a reply as plain denied', async () => {
    const { ctx } = makeContext({ input: '/tool shell ls', decide: () => ({ allowed: false }) });
    const events = await collect(createMockEngine().run(ctx));
    expect(events[1]).toEqual({ type: 'tool.result', callId: 'run_1:tool:0', ok: false, output: 'denied by user' });
  });

  it('turns /remember into a memory event', async () => {
    const { ctx } = makeContext({ input: '/remember the release is on Friday' });
    const events = await collect(createMockEngine().run(ctx));
    expect(events).toContainEqual({ type: 'memory', kind: 'fact', content: 'the release is on Friday' });
  });

  it('plays a scripted sequence instead of echoing', async () => {
    const driver = createMockEngine({
      script: [
        { type: 'text', text: 'Checking. ' },
        { type: 'tool', tool: 'publish', kind: 'publish', summary: 'Publish page', output: 'published' },
        { type: 'memory', kind: 'summary', content: 'Published the page' },
      ],
    });
    const { ctx, requests } = makeContext({ input: 'ignored' });
    const events: EngineEvent[] = await collect(driver.run(ctx));

    expect(requests[0]).toMatchObject({ tool: 'publish', kind: 'publish', args: {} });
    expect(events.map((e) => e.type)).toEqual([
      'text.delta',
      'tool.call',
      'tool.result',
      'memory',
      'usage',
    ]);
    expect(events[2]).toEqual({ type: 'tool.result', callId: 'run_1:tool:0', ok: true, output: 'published' });
  });

  it('stops promptly when aborted mid-stream and emits no usage', async () => {
    const controller = new AbortController();
    const { ctx } = makeContext({
      input: 'one two three four five six seven eight',
      signal: controller.signal,
    });
    const events: EngineEvent[] = [];
    const started = Date.now();
    for await (const event of createMockEngine({ delayMs: 200 }).run(ctx)) {
      events.push(event);
      if (events.length === 2) controller.abort();
    }

    expect(events.map((e) => e.type)).toEqual(['text.delta', 'text.delta']);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('stops while waiting on an approval that never resolves', async () => {
    const controller = new AbortController();
    const { ctx, requests } = makeContext({
      input: '/tool shell ls',
      signal: controller.signal,
      decide: () => new Promise<never>(() => undefined),
    });
    const run = collect(createMockEngine().run(ctx));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests).toHaveLength(1);

    controller.abort();
    await expect(run).resolves.toEqual([]);
  });
});
