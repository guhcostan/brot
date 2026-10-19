import type { ApprovalKind, EngineDriver, EngineEvent, MemoryKind, RunContext } from '@brot/protocol';
import { sleep, untilAborted } from './abort';

export type MockStep =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      tool: string;
      kind: ApprovalKind;
      summary: string;
      args?: Record<string, unknown>;
      output?: string;
    }
  | { type: 'memory'; kind: MemoryKind; content: string };

export interface MockEngineOptions {
  script?: MockStep[];
  delayMs?: number;
}

const SHELL_COMMAND = '/tool ';
const REMEMBER_COMMAND = '/remember ';

export function createMockEngine(opts: MockEngineOptions = {}): EngineDriver {
  const delayMs = opts.delayMs ?? 0;
  return {
    id: 'mock',
    label: 'Mock',
    async detect() {
      return { available: true };
    },
    async models() {
      return [{ id: 'mock-1', label: 'Mock' }];
    },
    async *run(ctx) {
      const steps = opts.script ?? stepsForInput(ctx.input);
      let output = '';
      for await (const event of playSteps(ctx, steps, delayMs)) {
        if (event.type === 'text.delta') output += event.delta;
        yield event;
      }
      if (!ctx.signal.aborted) {
        yield {
          type: 'usage',
          tokensIn: countTokens(ctx.input),
          tokensOut: countTokens(output),
          costUsd: 0,
        };
      }
    },
  };
}

/** `/tool <tool> <command>` requests a shell approval; `/remember <text>` writes a fact. */
function stepsForInput(input: string): MockStep[] {
  if (input.startsWith(SHELL_COMMAND)) {
    const [, word = '', command = ''] = /^(\S*)\s*([\s\S]*)$/.exec(input.slice(SHELL_COMMAND.length).trim()) ?? [];
    return [{ type: 'tool', tool: word || 'shell', kind: 'shell', summary: command, args: { command } }];
  }
  if (input.startsWith(REMEMBER_COMMAND)) {
    return [{ type: 'memory', kind: 'fact', content: input.slice(REMEMBER_COMMAND.length).trim() }];
  }
  return [{ type: 'text', text: `You said: ${input}` }];
}

async function* playSteps(ctx: RunContext, steps: MockStep[], delayMs: number): AsyncGenerator<EngineEvent> {
  let toolIndex = 0;
  for (const step of steps) {
    if (ctx.signal.aborted) return;
    if (step.type === 'text') {
      yield* streamText(step.text, delayMs, ctx);
    } else if (step.type === 'memory') {
      yield { type: 'memory', kind: step.kind, content: step.content };
    } else {
      const callId = `${ctx.runId}:tool:${toolIndex++}`;
      const args = step.args ?? {};
      const decision = await untilAborted(
        ctx.requestTool({ callId, tool: step.tool, args, kind: step.kind, summary: step.summary }),
        ctx.signal,
      );
      if (!decision || ctx.signal.aborted) return;
      yield { type: 'tool.call', callId, tool: step.tool, args };
      if (decision.allowed) {
        yield { type: 'tool.result', callId, ok: true, output: step.output ?? 'ok' };
      } else {
        const output = decision.reply ? `denied by user: ${decision.reply}` : 'denied by user';
        yield { type: 'tool.result', callId, ok: false, output };
      }
    }
  }
}

async function* streamText(text: string, delayMs: number, ctx: RunContext): AsyncGenerator<EngineEvent> {
  const chunks = text.split(/(?<=\s)/).filter((chunk) => chunk.length > 0);
  for (const [index, delta] of chunks.entries()) {
    if (index > 0) await sleep(delayMs, ctx.signal);
    if (ctx.signal.aborted) return;
    yield { type: 'text.delta', delta };
  }
}

function countTokens(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}
