import type { EngineDriver, EngineEvent, ModelInfo } from '@brot/protocol';
import { z } from 'zod';
import { parseJsonLine, probeCli, streamCli } from './cli';
import { buildPrompt } from './prompt';

const MISSING_REASON = 'claude CLI not found';

const AssistantLine = z.object({
  type: z.literal('assistant'),
  message: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }),
});

const ResultLine = z.object({
  type: z.literal('result'),
  is_error: z.boolean().optional(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  total_cost_usd: z.number().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

/**
 * Maps one `claude -p --output-format stream-json` line to canonical events.
 * Only assistant text and the final result's usage are mapped. Claude's own tool
 * use runs inside the CLI, so its tool_use blocks are not surfaced here.
 */
export function parseClaudeLine(line: string): EngineEvent[] {
  const raw = parseJsonLine(line);

  const assistant = AssistantLine.safeParse(raw);
  if (assistant.success) {
    return assistant.data.message.content.flatMap((block) =>
      block.type === 'text' && block.text ? [{ type: 'text.delta' as const, delta: block.text }] : [],
    );
  }

  const result = ResultLine.safeParse(raw);
  if (result.success && (result.data.usage || result.data.total_cost_usd !== undefined)) {
    const usage = result.data.usage ?? {};
    // Claude reports cached input separately from input_tokens; tokensIn counts all of it.
    const cachedIn = (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    return [
      {
        type: 'usage',
        tokensIn: (usage.input_tokens ?? 0) + cachedIn,
        tokensOut: usage.output_tokens ?? 0,
        costUsd: result.data.total_cost_usd ?? 0,
      },
    ];
  }
  return [];
}

/** Returns the error text when a stream-json result line reports a failed run. */
export function claudeFatalLine(line: string): string | undefined {
  const result = ResultLine.safeParse(parseJsonLine(line));
  if (!result.success || !result.data.is_error) return undefined;
  return result.data.result ?? result.data.subtype ?? 'unknown error';
}

export interface ClaudeEngineOptions {
  bin?: string;
}

export function createClaudeEngine(opts: ClaudeEngineOptions = {}): EngineDriver {
  const bin = opts.bin ?? 'claude';
  return {
    id: 'claude',
    label: 'Claude Code',
    detect: () => probeCli(bin, MISSING_REASON),
    async models(): Promise<ModelInfo[]> {
      return [
        { id: 'default', label: 'Default' },
        { id: 'opus', label: 'Opus' },
        { id: 'sonnet', label: 'Sonnet' },
        { id: 'fable', label: 'Fable' },
      ];
    },
    run(ctx) {
      const args = [
        '-p',
        buildPrompt(ctx),
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'default',
      ];
      if (ctx.bot.model && ctx.bot.model !== 'default') args.push('--model', ctx.bot.model);
      return streamCli({
        label: 'claude',
        bin,
        args,
        signal: ctx.signal,
        parseLine: parseClaudeLine,
        fatalLine: claudeFatalLine,
      });
    },
  };
}
