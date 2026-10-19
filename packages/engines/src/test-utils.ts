import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bot, Memory, Message, RunContext, ToolDecision, ToolRequest } from '@brot/protocol';

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
  bot?: Partial<Bot>;
  history?: Message[];
  memories?: Memory[];
  signal?: AbortSignal;
  decide?: (req: ToolRequest) => ToolDecision | Promise<ToolDecision>;
}

export function makeContext(opts: TestContextOptions = {}): { ctx: RunContext; requests: ToolRequest[] } {
  const requests: ToolRequest[] = [];
  const ctx: RunContext = {
    runId: 'run_1',
    threadId: 'thread_1',
    bot: { ...testBot, ...opts.bot },
    history: opts.history ?? [],
    input: opts.input ?? 'hello',
    memories: opts.memories ?? [],
    skills: [],
    signal: opts.signal ?? new AbortController().signal,
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

const fakeDirs: string[] = [];

/**
 * Writes an executable Node script that stands in for a CLI binary. `body` gets the
 * script's own directory so it can record the argv it was called with.
 */
export async function makeFakeCli(body: (dir: string) => string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brot-engines-'));
  fakeDirs.push(dir);
  const bin = join(dir, 'fake-cli');
  await writeFile(bin, `#!/usr/bin/env node\n${body(dir)}\n`);
  await chmod(bin, 0o755);
  return bin;
}

export async function removeFakeClis(): Promise<void> {
  await Promise.all(fakeDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
