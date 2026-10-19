import type {
  Bot,
  ComputerHandle,
  LlmRoute,
  McpServerSpec,
  Memory,
  Message,
  RunContext,
  ToolDecision,
  ToolRequest,
} from '@brot/protocol';

const AT = '2026-10-19T12:00:00.000Z';

export const testBot: Bot = {
  id: 'bot_1',
  name: 'Test bot',
  job: 'Testing',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: AT,
  updatedAt: AT,
};

export interface TestContextOptions {
  input?: string;
  threadId?: string;
  bot?: Partial<Bot>;
  history?: Message[];
  memories?: Memory[];
  signal?: AbortSignal;
  decide?: (req: ToolRequest) => ToolDecision | Promise<ToolDecision>;
  engineSessionId?: string;
  computer?: ComputerHandle;
  mcpServers?: McpServerSpec[];
  llm?: LlmRoute;
}

export function makeContext(opts: TestContextOptions = {}): { ctx: RunContext; requests: ToolRequest[] } {
  const requests: ToolRequest[] = [];
  const ctx: RunContext = {
    runId: 'run_1',
    threadId: opts.threadId ?? 'thread_1',
    bot: { ...testBot, ...opts.bot },
    history: opts.history ?? [],
    input: opts.input ?? 'hello',
    memories: opts.memories ?? [],
    skills: [],
    signal: opts.signal ?? new AbortController().signal,
    engineSessionId: opts.engineSessionId,
    computer: opts.computer,
    mcpServers: opts.mcpServers,
    llm: opts.llm,
    requestTool: async (req) => {
      requests.push(req);
      return opts.decide ? opts.decide(req) : { allowed: true };
    },
  };
  return { ctx, requests };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
