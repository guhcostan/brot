import { describe, expect, it } from 'vitest';
import { parseSse } from './sse';

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(chunks: Uint8Array[]) {
  const messages = [];
  for await (const message of parseSse(streamOf(chunks))) messages.push(message);
  return messages;
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('parseSse', () => {
  it('parses events with names, ids and multi-line data', async () => {
    const messages = await collect([
      encode('event: message.delta\nid: 1\ndata: {"a":1}\n\nevent: run.completed\ndata: line one\ndata: line two\n\n'),
    ]);
    expect(messages).toEqual([
      { event: 'message.delta', id: '1', data: '{"a":1}' },
      { event: 'run.completed', id: undefined, data: 'line one\nline two' },
    ]);
  });

  it('skips keep-alive comments and blocks without data', async () => {
    const messages = await collect([encode(': keep-alive\n\nevent: ping\n\ndata: kept\n\n')]);
    expect(messages).toEqual([{ event: undefined, id: undefined, data: 'kept' }]);
  });

  it('accepts CRLF line endings and fields without a space after the colon', async () => {
    const messages = await collect([encode('event:tick\r\ndata:x\r\n\r\n')]);
    expect(messages).toEqual([{ event: 'tick', id: undefined, data: 'x' }]);
  });

  it('reassembles lines and multi-byte characters split across chunks', async () => {
    const bytes = encode('data: olá 🥐\n\n');
    const messages = await collect([bytes.slice(0, 9), bytes.slice(9, 12), bytes.slice(12)]);
    expect(messages).toEqual([{ event: undefined, id: undefined, data: 'olá 🥐' }]);
  });

  it('discards an unterminated event at end of stream', async () => {
    expect(await collect([encode('data: partial\n')])).toEqual([]);
  });
});
