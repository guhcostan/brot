import type { EngineDriver, EngineEvent, ModelInfo } from '@brot/protocol';
import { z } from 'zod';
import { parseJsonLine, probeCli, streamCli } from './cli';
import { buildPrompt } from './prompt';

const MISSING_REASON = 'codex CLI not found';

const AgentMessageCompleted = z.object({
  type: z.literal('item.completed'),
  item: z.object({ type: z.literal('agent_message'), text: z.string() }),
});

const TurnCompleted = z.object({
  type: z.literal('turn.completed'),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
  }),
});

const TurnFailed = z.object({
  type: z.literal('turn.failed'),
  error: z.object({ message: z.string() }),
});

/**
 * Maps one `codex exec --json` line to canonical events. Only completed agent
 * messages and turn usage are mapped; other item and turn events are skipped.
 */
export function parseCodexLine(line: string): EngineEvent[] {
  const raw = parseJsonLine(line);

  const message = AgentMessageCompleted.safeParse(raw);
  if (message.success) {
    const text = message.data.item.text;
    return text ? [{ type: 'text.delta', delta: text }] : [];
  }

  const turn = TurnCompleted.safeParse(raw);
  if (turn.success) {
    return [
      {
        type: 'usage',
        tokensIn: turn.data.usage.input_tokens ?? 0,
        tokensOut: turn.data.usage.output_tokens ?? 0,
        costUsd: 0,
      },
    ];
  }
  return [];
}

/** Returns the error text when a turn fails. Only `turn.failed` is fatal; `error` events are skipped. */
export function codexFatalLine(line: string): string | undefined {
  const failed = TurnFailed.safeParse(parseJsonLine(line));
  return failed.success ? failed.data.error.message : undefined;
}

export interface CodexEngineOptions {
  bin?: string;
}

export function createCodexEngine(opts: CodexEngineOptions = {}): EngineDriver {
  const bin = opts.bin ?? 'codex';
  return {
    id: 'codex',
    label: 'Codex',
    detect: () => probeCli(bin, MISSING_REASON),
    async models(): Promise<ModelInfo[]> {
      return [{ id: 'default', label: 'Default' }];
    },
    run(ctx) {
      const args = ['exec', '--json'];
      if (ctx.bot.model && ctx.bot.model !== 'default') args.push('--model', ctx.bot.model);
      args.push(buildPrompt(ctx));
      return streamCli({
        label: 'codex',
        bin,
        args,
        signal: ctx.signal,
        parseLine: parseCodexLine,
        fatalLine: codexFatalLine,
      });
    },
  };
}
