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
