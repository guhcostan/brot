import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot } from '@brot/protocol';
import { call, createTestContext, type TestContext } from './testing';

const PRIMARY = 'opencode-go/deepseek-v4.1-flash';
const FALLBACK = 'deepseek/deepseek-flash';

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

describe('bot fallback models routes', () => {
  it('creates a bot with an ordered fallback chain and returns it', async () => {
    const bot = await createBot({ model: PRIMARY, fallbackModels: [FALLBACK, 'deepseek/deepseek-v4-pro'] });

    expect(bot.fallbackModels).toEqual([FALLBACK, 'deepseek/deepseek-v4-pro']);
    expect((await json<Bot>(await call(ctx.app, 'GET', `/api/bots/${bot.id}`))).fallbackModels).toEqual([
      FALLBACK,
      'deepseek/deepseek-v4-pro',
    ]);
  });

  it('sets, replaces and clears the fallback chain with a patch', async () => {
    const bot = await createBot();
    expect(bot.fallbackModels).toBeUndefined();

    const set = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { fallbackModels: [FALLBACK] });
    expect(set.status).toBe(200);
    expect((await json<Bot>(set)).fallbackModels).toEqual([FALLBACK]);

    const replaced = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { fallbackModels: [PRIMARY, FALLBACK] });
    expect((await json<Bot>(replaced)).fallbackModels).toEqual([PRIMARY, FALLBACK]);

    const cleared = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { fallbackModels: null });
    expect((await json<Bot>(cleared)).fallbackModels).toBeUndefined();

    const emptied = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { fallbackModels: [] });
    expect((await json<Bot>(emptied)).fallbackModels).toBeUndefined();
  });

  it('rejects a fallback ref whose provider this server does not know', async () => {
    const bot = await createBot();

    const created = await call(ctx.app, 'POST', '/api/bots', {
      name: 'Bo',
      job: 'x',
      fallbackModels: ['ghost/model-1'],
    });
    expect(created.status).toBe(400);
    const createdIssue = issuesOf(await created.json()).find((issue) => issue.path.includes('fallbackModels'));
    expect(createdIssue?.message).toContain('ghost/model-1');

    const patched = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, {
      fallbackModels: [FALLBACK, 'ghost/model-2'],
    });
    expect(patched.status).toBe(400);
    expect(issuesOf(await patched.json()).find((issue) => issue.path.includes('fallbackModels'))?.message).toContain(
      'ghost/model-2',
    );
  });

  it('rejects malformed refs, more than 3, and duplicates', async () => {
    const bot = await createBot();

    const malformed = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, { fallbackModels: ['no-slash'] });
    expect(malformed.status).toBe(400);
    expect(issuesOf(await malformed.json()).some((issue) => issue.path.includes('fallbackModels'))).toBe(true);

    const tooMany = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, {
      fallbackModels: ['a/b', 'c/d', 'e/f', 'g/h'],
    });
    expect(tooMany.status).toBe(400);
    expect(issuesOf(await tooMany.json()).some((issue) => issue.path.includes('fallbackModels'))).toBe(true);

    const duplicates = await call(ctx.app, 'PATCH', `/api/bots/${bot.id}`, {
      fallbackModels: [FALLBACK, FALLBACK],
    });
    expect(duplicates.status).toBe(400);
    expect(issuesOf(await duplicates.json()).some((issue) => issue.path.includes('fallbackModels'))).toBe(true);
  });
});
