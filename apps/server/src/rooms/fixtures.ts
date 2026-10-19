import { createEngineRegistry } from '@brot/engines';
import type { Bot, EngineDriver, Message, RunContext, Thread } from '@brot/protocol';
import type { ComputerProviders } from '../harness';
import { call, createTestContext, type TestContext } from '../testing';

export interface Recording {
  driver: EngineDriver;
  /** Every run the engine was asked to play, in start order. */
  runs: RunContext[];
}

/**
 * An engine that replies "<bot> replies to: <input>", records each run's context, and reports a session
 * per bot and thread. `costUsd` is reported with every run. With `holdUntilCancelled`, a run stays open
 * after its session until it is cancelled, and never replies.
 */
export function recordingEngine(options: { costUsd?: number; holdUntilCancelled?: boolean } = {}): Recording {
  const runs: RunContext[] = [];
  const driver: EngineDriver = {
    id: 'mock',
    label: 'Recording',
    detect: async () => ({ available: true }),
    models: async () => [],
    async *run(ctx) {
      runs.push(ctx);
      yield { type: 'engine.session', sessionId: `session:${ctx.bot.name}:${ctx.threadId}` };
      if (options.holdUntilCancelled) {
        await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve));
        return;
      }
      yield { type: 'text.delta', delta: `${ctx.bot.name} replies to: ${ctx.input}` };
      if (options.costUsd !== undefined) {
        yield { type: 'usage', tokensIn: 1, tokensOut: 1, costUsd: options.costUsd };
      }
    },
  };
  return { driver, runs };
}

const opened: TestContext[] = [];

export async function openContext(recording: Recording, computers: ComputerProviders = {}): Promise<TestContext> {
  const ctx = await createTestContext({ engines: createEngineRegistry([recording.driver]), computers });
  opened.push(ctx);
  return ctx;
}

export async function closeContexts(): Promise<void> {
  await Promise.all(opened.splice(0).map((ctx) => ctx.close()));
}

export function addBot(ctx: TestContext, name: string, extra: { teamBudgetUsd?: number } = {}): Promise<Bot> {
  return ctx.services.repos.bots.create({ name, job: `${name} job`, engine: 'mock', computer: 'none', instructions: '', ...extra });
}

export async function until(read: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function createDm(ctx: TestContext, botId: string): Promise<Thread> {
  return json<Thread>(await call(ctx.app, 'POST', `/api/bots/${botId}/threads`, {}));
}

export async function listMessages(ctx: TestContext, threadId: string): Promise<Message[]> {
  return json<Message[]>(await call(ctx.app, 'GET', `/api/threads/${threadId}/messages`));
}
