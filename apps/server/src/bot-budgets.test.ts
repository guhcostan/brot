import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from '@brot/protocol';
import { call, createTestContext, type TestContext } from './testing';

interface Issue {
  path: unknown[];
  message: string;
}

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createBot(body: Record<string, unknown> = {}): Promise<Bot> {
  const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', ...body });
  expect(res.status).toBe(201);
  return json<Bot>(res);
}

function issuesOf(body: unknown): Issue[] {
  return (body as { issues: Issue[] }).issues;
}

describe('bot budget routes', () => {
  it('creates a bot with run and daily budget caps and returns them', async () => {
    const bot = await createBot({ runBudgetUsd: 0.5, dailyBudgetUsd: 5 });

    expect(bot).toMatchObject({ runBudgetUsd: 0.5, dailyBudgetUsd: 5 });
    expect(await json<Bot>(await call(ctx.app, 'GET', `/api/bots/${bot.id}`))).toMatchObject({
      runBudgetUsd: 0.5,
      dailyBudgetUsd: 5,
    });
    const plain = await createBot();
    expect(plain.runBudgetUsd).toBeUndefined();
    expect(plain.dailyBudgetUsd).toBeUndefined();
  });

  it('sets, replaces and clears the caps with a patch', async () => {
    const bot = await createBot();

    const set = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { runBudgetUsd: 0.25, dailyBudgetUsd: 2 });
    expect(set.status).toBe(200);
    expect(await json<Bot>(set)).toMatchObject({ runBudgetUsd: 0.25, dailyBudgetUsd: 2 });

    const zero = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { runBudgetUsd: 0, dailyBudgetUsd: 0 });
    expect(await json<Bot>(zero)).toMatchObject({ runBudgetUsd: 0, dailyBudgetUsd: 0 });

    const cleared = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { runBudgetUsd: null, dailyBudgetUsd: null });
    const clearedBot = await json<Bot>(cleared);
    expect(clearedBot.runBudgetUsd).toBeUndefined();
    expect(clearedBot.dailyBudgetUsd).toBeUndefined();
  });

  it('rejects negative or non-numeric caps with the matching issue path', async () => {
    const bot = await createBot();

    const negativeRun = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { runBudgetUsd: -0.01 });
    expect(negativeRun.status).toBe(400);
    expect(issuesOf(await negativeRun.json()).some((issue) => issue.path.includes('runBudgetUsd'))).toBe(true);

    const negativeDaily = await call(ctx.app, 'POST', '/api/bots', {
      name: 'Bo',
      job: 'x',
      dailyBudgetUsd: -1,
    });
    expect(negativeDaily.status).toBe(400);
    expect(issuesOf(await negativeDaily.json()).some((issue) => issue.path.includes('dailyBudgetUsd'))).toBe(true);

    const textRun = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { runBudgetUsd: '0.5' });
    expect(textRun.status).toBe(400);
    expect(issuesOf(await textRun.json()).some((issue) => issue.path.includes('runBudgetUsd'))).toBe(true);

    const textDaily = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { dailyBudgetUsd: 'many' });
    expect(textDaily.status).toBe(400);
    expect(issuesOf(await textDaily.json()).some((issue) => issue.path.includes('dailyBudgetUsd'))).toBe(true);
  });
});
