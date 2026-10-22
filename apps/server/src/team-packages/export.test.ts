import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  TeamPackage,
  parseTeamPackage,
  type Bot,
  type Routine,
  type Skill,
  type Team,
  type Thread,
} from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const repos = () => ctx.services.repos;

async function createTeam(name: string, instructions = ''): Promise<Team> {
  return repos().teams.create({ name, instructions });
}

async function createBot(input: { name: string; teamId?: string; avatar?: string; engine?: string; model?: string }): Promise<Bot> {
  return repos().bots.create({
    name: input.name,
    job: `${input.name} job`,
    instructions: `${input.name} instructions`,
    ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    ...(input.avatar === undefined ? {} : { avatar: input.avatar }),
    ...(input.engine === undefined ? {} : { engine: input.engine }),
    ...(input.model === undefined ? {} : { model: input.model }),
  });
}

async function createRoom(title: string, leadBotId: string, botIds: string[], responder: 'lead' | 'mention' = 'lead'): Promise<Thread> {
  return repos().rooms.create({ title, botIds, leadBotId, responder });
}

async function createCronRoutine(botId: string, name: string, overrides: { cron?: string; timezone?: string } = {}): Promise<Routine> {
  return repos().routines.create({
    botId,
    name,
    instruction: `Run ${name}`,
    trigger: { type: 'cron', cron: overrides.cron ?? '0 9 * * *', ...(overrides.timezone === undefined ? {} : { timezone: overrides.timezone }) },
  });
}

async function createWebhookRoutine(botId: string, name: string): Promise<Routine> {
  return repos().routines.create({
    botId,
    name,
    instruction: 'From a webhook',
    trigger: { type: 'webhook', secret: `secret-${name}` },
  });
}

async function createSkill(name: string, botId?: string): Promise<Skill> {
  return repos().skills.create({ name, description: `${name} description`, body: `# ${name}`, ...(botId === undefined ? {} : { botId }) });
}

async function exportPackage(query = ''): Promise<{ res: Response; body: string }> {
  const res = await call(ctx.app, 'GET', `/api/team-packages/export${query}`);
  return { res, body: await res.text() };
}

async function parsedExport(query = ''): Promise<TeamPackage> {
  const { res, body } = await exportPackage(query);
  expect(res.status).toBe(200);
  const parsed = parseTeamPackage(body);
  if (!parsed.ok) throw new Error(`the export did not parse: ${JSON.stringify(parsed.issues)}`);
  return parsed.package;
}

describe('GET /api/team-packages/export', () => {
  it('exports the whole workspace as Markdown with local keys and no host choices or secrets', async () => {
    const growth = await createTeam('Growth', 'Ship weekly.');
    const ada = await createBot({ name: 'Ada', teamId: growth.id, avatar: 'capivara:black', engine: 'dsh', model: 'openai/gpt' });
    const grace = await createBot({ name: 'Grace', teamId: growth.id });
    const capy = await createBot({ name: 'Capy' });
    const archived = await createBot({ name: 'Archived' });
    await repos().bots.update(archived.id, { archived: true });

    await repos().teams.update(growth.id, { chiefBotId: ada.id });
    const room = await createRoom('Launch room', ada.id, [ada.id, grace.id], 'mention');
    const adaRoutine = await createCronRoutine(ada.id, 'Digest', { timezone: 'UTC' });
    const capyRoutine = await createCronRoutine(capy.id, 'Standup');
    const webhook = await createWebhookRoutine(ada.id, 'Deploy hook');
    const adaSkill = await createSkill('Triage', ada.id);
    const graceSkill = await createSkill('Voice', grace.id);
    const sharedSkill = await createSkill('House style');

    const { res, body } = await exportPackage();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="brot-workspace.md"');
    expect(body.startsWith('# Brot team package\n\n```json\n')).toBe(true);

    const pkg = await parsedExport();
    expect(pkg.teams.map((team) => team.name)).toEqual(['Growth']);
    expect(pkg.teams[0]?.instructions).toBe('Ship weekly.');
    expect(pkg.bots.map((bot) => bot.name).sort()).toEqual(['Ada', 'Capy', 'Grace']);
    expect(pkg.teams[0]?.chief).toBe(pkg.bots.find((bot) => bot.name === 'Ada')?.key);
    expect(pkg.rooms).toEqual([
      { title: 'Launch room', lead: pkg.bots.find((bot) => bot.name === 'Ada')?.key, members: expect.any(Array), responder: 'mention' },
    ]);
    expect(pkg.routines.map((routine) => routine.name).sort()).toEqual(['Digest', 'Standup']);
    expect(pkg.routines.every((routine) => routine.enabled === false)).toBe(true);
    expect(pkg.skills.map((skill) => skill.name).sort()).toEqual(['Triage', 'Voice']);
    expect(pkg.bots.find((bot) => bot.name === 'Ada')).toMatchObject({ avatar: 'capivara:black' });

    // No server ids, no secret, no host choices, no shared skills, no webhook routine.
    for (const id of [growth.id, ada.id, grace.id, capy.id, archived.id, room.id, adaRoutine.id, capyRoutine.id, webhook.id, adaSkill.id, graceSkill.id, sharedSkill.id]) {
      expect(body).not.toContain(id);
    }
    expect(body).not.toContain(`secret-${webhook.name}`);
    expect(body).not.toContain('Deploy hook');
    expect(body).not.toContain('House style');
    for (const bot of pkg.bots) {
      expect(bot).not.toHaveProperty('engine');
      expect(bot).not.toHaveProperty('model');
      expect(bot).not.toHaveProperty('computer');
      expect(bot).not.toHaveProperty('browser');
      expect(bot).not.toHaveProperty('egress');
      expect(bot).not.toHaveProperty('teamBudgetUsd');
    }
  });

  it('scopes a team export to that team, its rooms, routines and bot-scoped skills', async () => {
    const growth = await createTeam('Growth');
    const ops = await createTeam('Ops');
    const ada = await createBot({ name: 'Ada', teamId: growth.id });
    const grace = await createBot({ name: 'Grace', teamId: growth.id });
    const onca = await createBot({ name: 'Onça', teamId: ops.id });
    const jacare = await createBot({ name: 'Jacaré', teamId: ops.id });
    await createRoom('Growth room', ada.id, [ada.id, grace.id]);
    await createRoom('Ops room', onca.id, [onca.id, jacare.id]);
    await createCronRoutine(ada.id, 'Digest');
    await createCronRoutine(onca.id, 'Deploys');
    await createSkill('Triage', ada.id);
    await createSkill('Deploy notes', onca.id);
    await createSkill('Shared');

    const { res, body } = await exportPackage(`?teamId=${growth.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="brot-team-growth.md"');
    const pkg = await parsedExport(`?teamId=${growth.id}`);
    expect(pkg.teams.map((team) => team.name)).toEqual(['Growth']);
    expect(pkg.bots.map((bot) => bot.name).sort()).toEqual(['Ada', 'Grace']);
    expect(pkg.rooms.map((room) => room.title)).toEqual(['Growth room']);
    expect(pkg.routines.map((routine) => routine.name)).toEqual(['Digest']);
    expect(pkg.skills.map((skill) => skill.name)).toEqual(['Triage']);
    expect(body).not.toContain(ops.id);
    expect(body).not.toContain(onca.id);
    expect(body).not.toContain('Ops');
  });

  it('drops a team room whose other members are outside the package', async () => {
    const growth = await createTeam('Growth');
    const ops = await createTeam('Ops');
    const ada = await createBot({ name: 'Ada', teamId: growth.id });
    const grace = await createBot({ name: 'Grace', teamId: growth.id });
    const onca = await createBot({ name: 'Onça', teamId: ops.id });
    await createRoom('Mixed room', ada.id, [ada.id, onca.id]);
    await createRoom('Growth room', ada.id, [ada.id, grace.id]);

    const pkg = await parsedExport(`?teamId=${growth.id}`);
    expect(pkg.rooms.map((room) => room.title)).toEqual(['Growth room']);

    const workspace = await parsedExport();
    expect(workspace.rooms.map((room) => room.title).sort()).toEqual(['Growth room', 'Mixed room']);
  });

  it('answers 404 for an unknown team and 400 when the scope holds no bots', async () => {
    expect((await exportPackage(`?teamId=${crypto.randomUUID()}`)).res.status).toBe(404);

    const empty = await createTeam('Empty');
    const emptyExport = await exportPackage(`?teamId=${empty.id}`);
    expect(emptyExport.res.status).toBe(400);
    expect((JSON.parse(emptyExport.body) as { error: string }).error).toMatch(/no bots/);

    const fresh = await createTestContext();
    try {
      const res = await call(fresh.app, 'GET', '/api/team-packages/export');
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/no bots/);
    } finally {
      await fresh.close();
    }
  });
});
