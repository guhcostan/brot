import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, Thread } from '@brot/protocol';
import { call, createTestContext, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

interface Stream {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  /** Everything read so far, across calls. */
  text: string;
}

/** Reads until `done` holds for the complete SSE frames received so far. */
async function readFrames(stream: Stream, done: (frames: string[]) => boolean): Promise<void> {
  const decoder = new TextDecoder();
  while (!done(completeFrames(stream.text))) {
    const chunk = await stream.reader.read();
    if (chunk.done) throw new Error('event stream closed early');
    stream.text += decoder.decode(chunk.value, { stream: true });
  }
}

/** Frames are separated by a blank line. The trailing piece may be partial, so it is dropped. */
function completeFrames(text: string): string[] {
  return text.split('\n\n').slice(0, -1);
}

function eventTypes(frames: string[]): string[] {
  return frames.flatMap((frame) => {
    const line = frame.split('\n').find((item) => item.startsWith('data: '));
    if (!line) return [];
    return [(JSON.parse(line.slice('data: '.length)) as { type: string }).type];
  });
}

const countOf = (frames: string[], type: string): number =>
  frames.filter((frame) => frame.includes(`event: ${type}\n`)).length;

describe('GET /api/events', () => {
  it('replays stored events after the cursor, then streams live events', async () => {
    const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x' })).json()) as Bot;
    const thread = (await (await call(ctx.app, 'POST', `/api/bots/${bot.id}/threads`, { title: 'Chat' })).json()) as Thread;
    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'first' });

    const res = await call(ctx.app, 'GET', `/api/events?threadId=${thread.id}&after=1970-01-01T00:00:00.000Z`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('event stream has no body');
    const stream: Stream = { reader, text: '' };

    await readFrames(stream, (frames) => countOf(frames, 'run.completed') >= 1);
    expect(eventTypes(completeFrames(stream.text))[0]).toBe('message.completed');

    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'second' });
    await readFrames(stream, (frames) => countOf(frames, 'run.completed') >= 2);

    const types = eventTypes(completeFrames(stream.text));
    expect(types.filter((type) => type === 'run.started')).toHaveLength(2);
    expect(types.filter((type) => type === 'message.completed')).toHaveLength(4);
    await reader.cancel();
  });

  it('rejects a malformed after cursor', async () => {
    const res = await call(ctx.app, 'GET', '/api/events?after=yesterday');
    expect(res.status).toBe(400);
  });
});

/** Opens the SSE stream and returns an accumulating reader plus a cancel function. */
async function openEvents(
  query: string,
  headers: Record<string, string> = {},
): Promise<{ stream: Stream; cancel(): Promise<void> }> {
  const res = await ctx.app.request(`/api/events${query}`, { headers });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body?.getReader();
  if (!reader) throw new Error('event stream has no body');
  return { stream: { reader, text: '' }, cancel: () => reader.cancel() };
}

function frameIds(frames: string[]): string[] {
  return frames.flatMap((frame) => {
    const line = frame.split('\n').find((item) => item.startsWith('id: '));
    return line === undefined ? [] : [line.slice('id: '.length)];
  });
}

function frameData(frames: string[]): Array<{ id: string; type: string }> {
  return frames.flatMap((frame) => {
    const line = frame.split('\n').find((item) => item.startsWith('data: '));
    if (!line) return [];
    return [JSON.parse(line.slice('data: '.length)) as { id: string; type: string }];
  });
}

/** Creates a bot and a thread, posts one message, and waits until its run has ended (the events are stored). */
async function seededThread(title = 'Chat'): Promise<Thread> {
  const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'x' })).json()) as Bot;
  const thread = (await (await call(ctx.app, 'POST', `/api/bots/${bot.id}/threads`, { title })).json()) as Thread;
  await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'first' });
  const deadline = Date.now() + 3000;
  for (;;) {
    const events = await storedEvents(thread.id);
    if (events.some((event) => event.type === 'run.completed')) return thread;
    if (Date.now() > deadline) throw new Error('the seeded run did not end');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function storedEvents(threadId: string): Promise<Array<{ id: string; type: string }>> {
  return (await (await call(ctx.app, 'GET', `/api/threads/${threadId}/events`)).json()) as Array<{
    id: string;
    type: string;
  }>;
}

describe('GET /api/events Last-Event-ID resume', () => {
  it('resumes strictly after the cursor event, with no duplicate and no gap, then streams live', async () => {
    const thread = await seededThread();
    const events = await storedEvents(thread.id);
    expect(events.length).toBeGreaterThan(3);
    const cursor = events[2]!;
    const expected = events.slice(3).map((event) => event.id);

    const opened = await openEvents(`?threadId=${thread.id}`, { 'last-event-id': cursor.id });
    await readFrames(opened.stream, (frames) => frames.length >= expected.length);

    const frames = completeFrames(opened.stream.text);
    expect(frameIds(frames)).toEqual(expected);
    expect(frameIds(frames)).not.toContain(cursor.id);
    const data = frameData(frames);
    expect(data.map((event) => event.id)).toEqual(expected);
    for (const event of data) expect((event as { type: string }).type).toEqual(expect.any(String));

    // The same stream still carries live events after the replay.
    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'second' });
    await readFrames(opened.stream, (received) => received.length > expected.length);
    expect(frameIds(completeFrames(opened.stream.text)).slice(0, expected.length)).toEqual(expected);
    await opened.cancel();
  });

  it('applies the threadId filter to replayed frames', async () => {
    const first = await seededThread('First');
    const second = await seededThread('Second');
    const firstEvents = await storedEvents(first.id);
    const secondEvents = await storedEvents(second.id);
    const cursor = firstEvents[1]!;
    const expected = firstEvents.slice(2).map((event) => event.id);

    const opened = await openEvents(`?threadId=${first.id}`, { 'last-event-id': cursor.id });
    await readFrames(opened.stream, (frames) => frames.length >= expected.length);

    const ids = frameIds(completeFrames(opened.stream.text));
    expect(ids).toEqual(expected);
    expect(ids.some((id) => secondEvents.some((event) => event.id === id))).toBe(false);
    await opened.cancel();
  });

  it('replays nothing and still streams live for an unknown cursor id', async () => {
    const thread = await seededThread();
    const oldIds = (await storedEvents(thread.id)).map((event) => event.id);

    const opened = await openEvents(`?threadId=${thread.id}`, { 'last-event-id': 'no-such-event-id' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(completeFrames(opened.stream.text)).toEqual([]);

    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'live' });
    await readFrames(opened.stream, (frames) => frames.length >= 1);
    const ids = frameIds(completeFrames(opened.stream.text));
    expect(ids.some((id) => oldIds.includes(id))).toBe(false);
    await opened.cancel();
  });

  it('ignores a malformed Last-Event-ID header and streams live', async () => {
    const thread = await seededThread();
    const oldIds = (await storedEvents(thread.id)).map((event) => event.id);

    const opened = await openEvents(`?threadId=${thread.id}`, { 'last-event-id': '   ' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(completeFrames(opened.stream.text)).toEqual([]);

    await call(ctx.app, 'POST', `/api/threads/${thread.id}/messages`, { content: 'live' });
    await readFrames(opened.stream, (frames) => frames.length >= 1);
    expect(frameIds(completeFrames(opened.stream.text)).some((id) => oldIds.includes(id))).toBe(false);
    await opened.cancel();
  });

  it('lets ?after win over the Last-Event-ID header', async () => {
    const thread = await seededThread();
    const events = await storedEvents(thread.id);
    const cursor = events[Math.floor(events.length / 2)]!;

    const opened = await openEvents(`?threadId=${thread.id}&after=1970-01-01T00:00:00.000Z`, {
      'last-event-id': cursor.id,
    });
    await readFrames(opened.stream, (frames) => frames.length >= events.length);

    expect(frameIds(completeFrames(opened.stream.text))).toEqual(events.map((event) => event.id));
    await opened.cancel();
  });

  it('replays every same-timestamp event after the cursor in rowid order', async () => {
    const bot = await ctx.services.repos.bots.create({ name: 'Ada', job: 'x', engine: 'mock' });
    const thread = await ctx.services.repos.threads.create(bot.id, { title: 'Ties' });
    const at = '2026-10-19T12:00:00.000Z';
    for (const id of ['tie-a', 'tie-b', 'tie-c']) {
      await ctx.services.repos.events.append({
        id,
        at,
        threadId: thread.id,
        type: 'run.started',
        botId: bot.id,
        engine: 'mock',
      });
    }

    const opened = await openEvents(`?threadId=${thread.id}`, { 'last-event-id': 'tie-a' });
    await readFrames(opened.stream, (frames) => frames.length >= 2);
    expect(frameIds(completeFrames(opened.stream.text))).toEqual(['tie-b', 'tie-c']);
    await opened.cancel();
  });
});
