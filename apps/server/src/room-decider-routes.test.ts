import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderSpec } from './llm';
import { call, createTestContext, type TestContext } from './testing';

const ANTHROPIC_PROVIDER: ProviderSpec = {
  id: 'anthropic-test',
  api: 'anthropic-messages',
  baseUrl: 'https://anthropic.example/v1',
  secretName: 'anthropic-test',
};

interface Issue {
  path: unknown[];
  message: string;
}

const contexts: TestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.close()));
});

async function open(): Promise<TestContext> {
  const ctx = await createTestContext({ llm: { providers: [ANTHROPIC_PROVIDER] } });
  contexts.push(ctx);
  return ctx;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function issuesOf(body: unknown): Issue[] {
  return (body as { issues: Issue[] }).issues;
}

describe('room decider routes', () => {
  it('returns an empty object when no decider is configured, and saves the model', async () => {
    const ctx = await open();
    expect(await json(await call(ctx.app, 'GET', '/api/room-decider'))).toEqual({});

    const saved = await call(ctx.app, 'PUT', '/api/room-decider', { model: 'deepseek/deepseek-flash' });
    expect(saved.status).toBe(200);
    const settings = await json<{ model?: string; updatedAt?: string }>(saved);
    expect(settings).toMatchObject({ model: 'deepseek/deepseek-flash', updatedAt: expect.any(String) });
    expect(await json(await call(ctx.app, 'GET', '/api/room-decider'))).toEqual(settings);

    const kept = await call(ctx.app, 'PUT', '/api/room-decider', {});
    expect(kept.status).toBe(200);
    expect(await json(kept)).toEqual(settings);
  });

  it('clears the decider with null', async () => {
    const ctx = await open();
    await call(ctx.app, 'PUT', '/api/room-decider', { model: 'deepseek/deepseek-flash' });

    const cleared = await call(ctx.app, 'PUT', '/api/room-decider', { model: null });
    expect(cleared.status).toBe(200);
    expect(await json(cleared)).toEqual({});
    expect(await json(await call(ctx.app, 'GET', '/api/room-decider'))).toEqual({});
  });

  it('rejects an unknown provider, a non-openai provider and a malformed ref on the model path', async () => {
    const ctx = await open();

    const unknown = await call(ctx.app, 'PUT', '/api/room-decider', { model: 'ghost/model-1' });
    expect(unknown.status).toBe(400);
    const unknownIssue = issuesOf(await unknown.json()).find((issue) => issue.path.includes('model'));
    expect(unknownIssue?.message).toContain('unknown model provider "ghost"');

    const incompatible = await call(ctx.app, 'PUT', '/api/room-decider', { model: 'anthropic-test/claude-x' });
    expect(incompatible.status).toBe(400);
    const incompatibleIssue = issuesOf(await incompatible.json()).find((issue) => issue.path.includes('model'));
    expect(incompatibleIssue?.message).toContain('openai-completions');

    const malformed = await call(ctx.app, 'PUT', '/api/room-decider', { model: 'no-slash' });
    expect(malformed.status).toBe(400);
    expect(issuesOf(await malformed.json()).some((issue) => issue.path.includes('model'))).toBe(true);

    expect(await json(await call(ctx.app, 'GET', '/api/room-decider'))).toEqual({});
  });
});
