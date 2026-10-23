import type { ProviderModel } from './providers';

/** Token counts one provider response reported. */
export interface TokenCounts {
  tokensIn: number;
  tokensOut: number;
}

/**
 * Longest partial SSE line, or non-streamed JSON body, the tap keeps for parsing. Larger payloads are not
 * parsed for usage. They still stream through unchanged.
 */
const MAX_TAP_CHARS = 4 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

/**
 * Usage carried by one parsed response object. Covers chat completions (`usage.prompt_tokens`), responses
 * (`usage.input_tokens` or `response.usage`) and Anthropic messages (`message.usage` on `message_start`,
 * `usage` on `message_delta`). A partial object returns only the fields it has.
 */
export function usageOf(value: unknown): Partial<TokenCounts> | undefined {
  if (!isRecord(value)) return undefined;
  const candidates = [
    value.usage,
    isRecord(value.response) ? value.response.usage : undefined,
    isRecord(value.message) ? value.message.usage : undefined,
  ];
  for (const usage of candidates) {
    if (!isRecord(usage)) continue;
    const tokensIn = count(usage.prompt_tokens) ?? count(usage.input_tokens);
    const tokensOut = count(usage.completion_tokens) ?? count(usage.output_tokens);
    if (tokensIn !== undefined || tokensOut !== undefined) {
      return {
        ...(tokensIn === undefined ? {} : { tokensIn }),
        ...(tokensOut === undefined ? {} : { tokensOut }),
      };
    }
  }
  return undefined;
}

/** Estimated USD cost of the tokens. Zero when the model has no known price. */
export function costOf(model: ProviderModel | undefined, tokensIn: number, tokensOut: number): number {
  if (model?.cost === undefined) return 0;
  return (tokensIn * model.cost.input + tokensOut * model.cost.output) / 1_000_000;
}

/**
 * Incremental usage parser for one provider response. Feed it each body chunk; `finish()` reports the usage seen
 * so far (at most once). This is the same parsing the tap below performs, exposed so a caller that wraps the body
 * (for stall timeouts) can report partial usage when the stream is aborted instead of ending normally.
 */
export interface UsageSink {
  push(chunk: Uint8Array): void;
  finish(): void;
}

/**
 * Builds the usage sink. Server-sent events are parsed line by line as they arrive, so a chunk is forwarded before
 * it is parsed. Usage that arrives in more than one event (Anthropic's `message_start` and `message_delta`) is
 * merged field by field, so the last value seen for each count wins.
 */
export function createUsageSink(contentType: string | null, report: (usage: TokenCounts) => void): UsageSink {
  const streaming = /text\/event-stream/i.test(contentType ?? '');
  const decoder = new TextDecoder();
  const seen: Partial<TokenCounts> = {};
  let pending = '';
  let overflow = false;
  let finished = false;

  const absorb = (value: unknown): void => {
    const usage = usageOf(value);
    if (usage === undefined) return;
    if (usage.tokensIn !== undefined) seen.tokensIn = usage.tokensIn;
    if (usage.tokensOut !== undefined) seen.tokensOut = usage.tokensOut;
  };

  const absorbEventLine = (line: string): void => {
    if (!line.startsWith('data:')) return;
    try {
      absorb(JSON.parse(line.slice('data:'.length).trim()));
    } catch {
      // `[DONE]` and other non-JSON data lines carry no usage.
    }
  };

  return {
    push(chunk) {
      if (finished || overflow) return;
      pending += decoder.decode(chunk, { stream: true });
      if (streaming) {
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) absorbEventLine(line.trim());
        if (pending.length > MAX_TAP_CHARS) pending = '';
      } else if (pending.length > MAX_TAP_CHARS) {
        overflow = true;
        pending = '';
      }
    },

    finish() {
      if (finished) return;
      finished = true;
      pending += decoder.decode();
      if (!overflow) {
        if (streaming) {
          absorbEventLine(pending.trim());
        } else {
          try {
            absorb(JSON.parse(pending));
          } catch {
            // Not JSON: nothing to report.
          }
        }
      }
      if (seen.tokensIn !== undefined || seen.tokensOut !== undefined) {
        report({ tokensIn: seen.tokensIn ?? 0, tokensOut: seen.tokensOut ?? 0 });
      }
    },
  };
}

/** Passes a provider response through unchanged and reports its final usage once the body ends. */
export function createUsageTap(
  contentType: string | null,
  report: (usage: TokenCounts) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const sink = createUsageSink(contentType, report);
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      sink.push(chunk);
    },
    flush() {
      sink.finish();
    },
  });
}
