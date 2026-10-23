import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bot, BotPreset } from '@brot/protocol';
import { call, createTestContext, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function createBot(overrides: Record<string, unknown> = {}): Promise<Bot> {
  const res = await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Researcher', ...overrides });
  expect(res.status).toBe(201);
  return (await res.json()) as Bot;
}

async function createPreset(body: Record<string, unknown>): Promise<BotPreset> {
  const res = await call(ctx.app, 'POST', '/api/presets', body);
  expect(res.status).toBe(201);
  return (await res.json()) as BotPreset;
}

async function listPresets(): Promise<BotPreset[]> {
  return (await (await call(ctx.app, 'GET', '/api/presets')).json()) as BotPreset[];
}

describe('bot presets API', () => {
  it('creates, lists, updates and deletes presets', async () => {
    const created = await createPreset({ name: 'Researcher', job: 'Reads papers', avatar: 'capivara:black' });
    expect(created).toMatchObject({
      name: 'Researcher',
      job: 'Reads papers',
      instructions: '',
      avatar: 'capivara:black',
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();

    await createPreset({ name: 'Ops', job: 'Keeps things up', instructions: 'Be terse.' });
    const listed = await listPresets();
    expect(listed.map((preset) => preset.name)).toEqual(['Ops', 'Researcher']);
    expect(listed[0]?.instructions).toBe('Be terse.');
    expect(listed[0]?.avatar).toBeUndefined();

    const patched = await call(ctx.app, 'PATCH', `/api/presets/${created.id}`, {
      name: 'Senior researcher',
      instructions: 'Say more.',
      avatar: 'onca:blue',
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      id: created.id,
      name: 'Senior researcher',
      job: 'Reads papers',
      instructions: 'Say more.',
      avatar: 'onca:blue',
    });

    expect((await call(ctx.app, 'DELETE', `/api/presets/${created.id}`)).status).toBe(204);
    expect((await call(ctx.app, 'DELETE', `/api/presets/${created.id}`)).status).toBe(404);
    expect((await call(ctx.app, 'PATCH', `/api/presets/${created.id}`, { name: 'x' })).status).toBe(404);
    expect((await call(ctx.app, 'DELETE', '/api/presets/unknown')).status).toBe(404);
  });

  it('allows two presets with the same name', async () => {
    const first = await createPreset({ name: 'Same', job: 'Reads' });
    const second = await createPreset({ name: 'Same', job: 'Writes' });
    expect(first.name).toBe(second.name);
    expect((await listPresets()).filter((preset) => preset.name === 'Same')).toHaveLength(2);
  });

  it('rejects invalid preset bodies with 400 issues', async () => {
    async function issuesOf(body: unknown): Promise<{ path: (string | number)[] }[]> {
      const res = await call(ctx.app, 'POST', '/api/presets', body);
      expect(res.status).toBe(400);
      return ((await res.json()) as { issues: { path: (string | number)[] }[] }).issues;
    }

    async function expectIssue(body: unknown, field: string): Promise<void> {
      const issues = await issuesOf(body);
      expect(issues.some((issue) => issue.path.includes(field))).toBe(true);
    }

    await expectIssue({}, 'name');
    await expectIssue({ name: '', job: 'Writes' }, 'name');
    await expectIssue({ name: 'x'.repeat(121), job: 'Writes' }, 'name');
    await expectIssue({ name: 'Writes' }, 'job');
    await expectIssue({ name: 'x', job: 'y', avatar: 'ada.png' }, 'avatar');
    await expectIssue({ name: 'x', job: 'y', instructions: 'x'.repeat(20_001) }, 'instructions');

    expect((await call(ctx.app, 'PATCH', '/api/presets/anything', { name: '' })).status).toBe(400);
  });

  it('copies a bot into a preset, with an optional name override', async () => {
    const bot = await createBot({
      name: 'Capy',
      job: 'Chief of Staff',
      instructions: 'Be calm.',
      avatar: 'capivara:black',
    });

    const copied = await call(ctx.app, 'POST', `/api/presets/from-bot/${bot.id}`);
    expect(copied.status).toBe(201);
    expect(await copied.json()).toMatchObject({
      name: 'Capy',
      job: 'Chief of Staff',
      instructions: 'Be calm.',
      avatar: 'capivara:black',
    });

    const renamed = await call(ctx.app, 'POST', `/api/presets/from-bot/${bot.id}`, { name: 'Capy template' });
    expect(renamed.status).toBe(201);
    expect(await renamed.json()).toMatchObject({ name: 'Capy template', job: 'Chief of Staff' });

    expect((await call(ctx.app, 'POST', '/api/presets/from-bot/unknown')).status).toBe(404);
    expect((await call(ctx.app, 'POST', `/api/presets/from-bot/${bot.id}`, { name: '' })).status).toBe(400);
    // The bot check comes first: an unknown bot is a 404 even when the body is invalid.
    expect((await call(ctx.app, 'POST', '/api/presets/from-bot/unknown', { name: '' })).status).toBe(404);
  });
});
