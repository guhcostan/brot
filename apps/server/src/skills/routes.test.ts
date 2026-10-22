import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatSkillFile, type Bot, type Skill } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;
let bot: Bot;

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
  bot = await ctx.services.repos.bots.create({ name: 'Ada', job: 'Researcher', engine: 'mock' });
});

afterEach(async () => {
  await ctx.close();
});

async function createSkill(overrides: Record<string, unknown> = {}): Promise<Skill> {
  return ctx.services.repos.skills.create({
    name: 'Review Pull Requests',
    description: 'Review a pull request carefully.',
    body: '# Review\n\n1. Read the diff.',
    ...overrides,
  });
}

describe('GET /api/skills/:id/export', () => {
  it('downloads the skill as a SKILL.md markdown attachment', async () => {
    const skill = await createSkill();
    const res = await call(ctx.app, 'GET', `/api/skills/${skill.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="review-pull-requests.SKILL.md"');
    expect(await res.text()).toBe(
      formatSkillFile({ name: skill.name, description: skill.description, body: skill.body }),
    );
  });

  it('slugifies a name with punctuation and non-ASCII characters', async () => {
    const skill = await createSkill({ name: 'Café Ops! / déploiement' });
    const res = await call(ctx.app, 'GET', `/api/skills/${skill.id}/export`);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="cafe-ops-deploiement.SKILL.md"');
  });

  it('answers 404 for an unknown skill', async () => {
    const res = await call(ctx.app, 'GET', '/api/skills/nope/export');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Skill not found' });
  });
});

describe('POST /api/skills/import', () => {
  it('round-trips an exported skill, as a shared skill', async () => {
    const skill = await createSkill();
    const exported = await (await call(ctx.app, 'GET', `/api/skills/${skill.id}/export`)).text();

    const res = await call(ctx.app, 'POST', '/api/skills/import', { content: exported });
    expect(res.status).toBe(201);
    const imported = (await res.json()) as Skill;
    expect(imported).toMatchObject({
      name: skill.name,
      description: skill.description,
      body: skill.body,
      version: 1,
    });
    expect(imported.botId).toBeUndefined();
    expect(imported.id).not.toBe(skill.id);

    const listed = (await (await call(ctx.app, 'GET', '/api/skills')).json()) as Skill[];
    expect(listed.map((item) => item.id)).toEqual(expect.arrayContaining([skill.id, imported.id]));
  });

  it('imports a skill for one bot, and refuses an unknown bot', async () => {
    const skill = await createSkill();
    const exported = await (await call(ctx.app, 'GET', `/api/skills/${skill.id}/export`)).text();

    const res = await call(ctx.app, 'POST', '/api/skills/import', { content: exported, botId: bot.id });
    expect(res.status).toBe(201);
    expect(((await res.json()) as Skill).botId).toBe(bot.id);

    const unknown = await call(ctx.app, 'POST', '/api/skills/import', { content: exported, botId: 'nope' });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Bot not found' });
  });

  it('takes the name of a frontmatter-less document from the query or the body', async () => {
    const fromQuery = await call(ctx.app, 'POST', '/api/skills/import?name=from-query', { content: 'Just the body.' });
    expect(fromQuery.status).toBe(201);
    expect(await fromQuery.json()).toMatchObject({ name: 'from-query', description: '', body: 'Just the body.' });

    const fromBody = await call(ctx.app, 'POST', '/api/skills/import', { content: 'Body only.', name: 'from-body' });
    expect(fromBody.status).toBe(201);
    expect(await fromBody.json()).toMatchObject({ name: 'from-body', body: 'Body only.' });

    const missing = await call(ctx.app, 'POST', '/api/skills/import', { content: 'No name anywhere.' });
    expect(missing.status).toBe(400);
    const issues = ((await missing.json()) as { error: string; issues: { path: string[] }[] }).issues;
    expect(issues[0]?.path).toEqual(['name']);
  });

  it('accepts a raw JSON skill', async () => {
    const res = await call(ctx.app, 'POST', '/api/skills/import', {
      content: JSON.stringify({ name: 'json-skill', description: 'From JSON', body: '# Body' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'json-skill', description: 'From JSON', body: '# Body' });
  });

  it('answers 400 with issues for invalid content and an oversized payload', async () => {
    const broken = await call(ctx.app, 'POST', '/api/skills/import', { content: '---\nname: broken\n' });
    expect(broken.status).toBe(400);
    const body = (await broken.json()) as { error: string; issues: { path: string[]; message: string }[] };
    expect(body.error).toBe('Invalid request');
    expect(body.issues[0]?.message).toMatch(/not closed/);

    expect((await call(ctx.app, 'POST', '/api/skills/import', { content: '' })).status).toBe(400);
    expect((await call(ctx.app, 'POST', '/api/skills/import', { content: 'x'.repeat(600_001) })).status).toBe(400);
  });

  it('requires a JSON write, like every state-changing route', async () => {
    const res = await ctx.app.request('/api/skills/import', { method: 'POST' });
    expect(res.status).toBe(415);
  });

  it('requires device auth from a remote caller', async () => {
    expect((await ctx.remote.request('/api/skills/import', { method: 'POST' })).status).toBe(415);
    const withJson = await ctx.remote.request('/api/skills/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '{"name":"x"}' }),
    });
    expect(withJson.status).toBe(401);
    expect((await ctx.remote.request('/api/skills/any/export')).status).toBe(401);
  });
});
