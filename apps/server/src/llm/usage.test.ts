import { describe, expect, it } from 'vitest';
import { costOf, createUsageTap, usageOf, type TokenCounts } from './usage';

const encoder = new TextEncoder();

/** Runs the chunks through the tap and returns what it forwarded and what it reported. */
async function tap(contentType: string, chunks: string[]): Promise<{ forwarded: string; reports: TokenCounts[] }> {
  const reports: TokenCounts[] = [];
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const out = source.pipeThrough(createUsageTap(contentType, (usage) => reports.push(usage)));
  const forwarded = await new Response(out).text();
  return { forwarded, reports };
}

describe('usageOf', () => {
  it('reads chat completions, responses and anthropic shapes', () => {
    expect(usageOf({ usage: { prompt_tokens: 10, completion_tokens: 4 } })).toEqual({ tokensIn: 10, tokensOut: 4 });
    expect(usageOf({ type: 'response.completed', response: { usage: { input_tokens: 7, output_tokens: 3 } } })).toEqual({
      tokensIn: 7,
      tokensOut: 3,
    });
    expect(usageOf({ type: 'message_start', message: { usage: { input_tokens: 25, output_tokens: 1 } } })).toEqual({
      tokensIn: 25,
      tokensOut: 1,
    });
    expect(usageOf({ type: 'message_delta', usage: { output_tokens: 15 } })).toEqual({ tokensOut: 15 });
  });

  it('ignores objects without usage, and counts that are not non-negative numbers', () => {
    expect(usageOf({ choices: [] })).toBeUndefined();
    expect(usageOf({ usage: { prompt_tokens: -1, completion_tokens: 'many' } })).toBeUndefined();
    expect(usageOf(null)).toBeUndefined();
  });
});

describe('costOf', () => {
  it('prices tokens per million and returns zero for a model without a cost', () => {
    expect(costOf({ id: 'm', cost: { input: 1, output: 2 } }, 10, 5)).toBeCloseTo(0.00002, 12);
    expect(costOf({ id: 'm' }, 10, 5)).toBe(0);
    expect(costOf(undefined, 10, 5)).toBe(0);
  });
});

describe('createUsageTap', () => {
  it('reports a JSON response once, after the body ends, and forwards it unchanged', async () => {
    const body = JSON.stringify({ id: 'x', usage: { prompt_tokens: 12, completion_tokens: 6 } });
    const { forwarded, reports } = await tap('application/json', [body.slice(0, 10), body.slice(10)]);
    expect(forwarded).toBe(body);
    expect(reports).toEqual([{ tokensIn: 12, tokensOut: 6 }]);
  });

  it('reports the final chat completion usage chunk of a stream', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ];
    const { forwarded, reports } = await tap('text/event-stream', chunks);
    expect(forwarded).toBe(chunks.join(''));
    expect(reports).toEqual([{ tokensIn: 9, tokensOut: 2 }]);
  });

  it('parses events that a chunk boundary splits, one byte at a time', async () => {
    const stream = 'data: {"usage":{"prompt_tokens":3,"completion_tokens":8}}\n\ndata: [DONE]\n\n';
    const { forwarded, reports } = await tap('text/event-stream', stream.split(''));
    expect(forwarded).toBe(stream);
    expect(reports).toEqual([{ tokensIn: 3, tokensOut: 8 }]);
  });

  it('merges anthropic usage split across message_start and message_delta', async () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":40,"output_tokens":1}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":22}}\n\n',
    ];
    const { reports } = await tap('text/event-stream', chunks);
    expect(reports).toEqual([{ tokensIn: 40, tokensOut: 22 }]);
  });

  it('reports nothing when the response carries no usage', async () => {
    const { forwarded, reports } = await tap('text/event-stream', ['data: {"choices":[]}\n\n']);
    expect(forwarded).toBe('data: {"choices":[]}\n\n');
    expect(reports).toEqual([]);
  });
});
