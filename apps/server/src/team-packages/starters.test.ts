import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TeamPackage, type AdminActivity, type Bot, type Routine, type Skill, type Team } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';
import {
  STARTER_TEAMS,
  starterTeamById,
  starterTeamPackage,
  starterTeamSummary,
  type StarterTeam,
} from './starters';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

function starter(id: string): StarterTeam {
  const found = starterTeamById(id);
  if (found === undefined) throw new Error(`no starter ${id}`);
  return found;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function install(id: string): Promise<Response> {
  return call(ctx.app, 'POST', `/api/team-packages/starters/${id}/install`);
}

describe('starter team definitions', () => {
  it('ships three deterministic packages that parse with the protocol schema', () => {
    expect(STARTER_TEAMS.map((entry) => entry.id)).toEqual(['dev-team', 'content-studio', 'ops-desk']);
    expect(new Set(STARTER_TEAMS.map((entry) => entry.id)).size).toBe(3);
    for (const entry of STARTER_TEAMS) {
      expect(TeamPackage.safeParse(entry.package).success).toBe(true);
      const served = starterTeamPackage(entry, new Date('2026-10-23T05:00:00.000Z'));
      expect(served.exportedAt).toBe('2026-10-23T05:00:00.000Z');
      expect(TeamPackage.safeParse(served).success).toBe(true);
    }
  });

  it('keeps keys unique and resolves every cross-reference inside each package', () => {
    for (const entry of STARTER_TEAMS) {
      const pkg = entry.package;
      const botKeys = new Set(pkg.bots.map((bot) => bot.key));
      expect(botKeys.size).toBe(pkg.bots.length);
      const teamKeys = new Set(pkg.teams.map((team) => team.key));
      expect(teamKeys.size).toBe(pkg.teams.length);

      for (const bot of pkg.bots) {
        if (bot.team !== undefined) expect(teamKeys.has(bot.team)).toBe(true);
      }
      for (const team of pkg.teams) {
        if (team.chief !== undefined) expect(botKeys.has(team.chief)).toBe(true);
      }
      for (const room of pkg.rooms) {
        expect(botKeys.has(room.lead)).toBe(true);
        for (const member of room.members) expect(botKeys.has(member)).toBe(true);
        expect(room.members).toContain(room.lead);
      }
      for (const routine of pkg.routines) expect(botKeys.has(routine.bot)).toBe(true);
      for (const skill of pkg.skills) {
        if (skill.bot !== undefined) expect(botKeys.has(skill.bot)).toBe(true);
      }
    }
  });

  it('defines the documented rosters and summaries', () => {
    const dev = starter('dev-team');
    expect(dev.name).toBe('Dev team');
    expect(dev.package.bots.map((bot) => bot.name)).toEqual(['Capy', 'Onça', 'Lobo']);
    expect(dev.package.teams[0]).toMatchObject({ name: 'Engineering', chief: 'capy' });
    expect(dev.package.rooms[0]).toMatchObject({
      title: 'Build room',
      lead: 'capy',
      members: ['capy', 'onca', 'lobo'],
      responder: 'lead',
    });
    expect(dev.package.skills[0]).toMatchObject({ name: 'Unified diff' });
    expect(dev.package.skills[0]?.bot).toBeUndefined();
    expect(dev.package.routines[0]).toMatchObject({
      bot: 'onca',
      name: 'Daily repo check',
      cron: '0 9 * * 1-5',
      enabled: false,
    });

    const content = starter('content-studio');
    expect(content.package.bots.map((bot) => bot.name)).toEqual(['Arara', 'Mico', 'Boto']);
    expect(content.package.teams[0]).toMatchObject({ name: 'Content', chief: 'arara' });
    expect(content.package.rooms[0]).toMatchObject({ title: 'Editorial room', lead: 'arara', responder: 'mention' });
    expect(content.package.skills[0]).toMatchObject({ name: 'Hook checklist' });

    const ops = starter('ops-desk');
    expect(ops.package.bots.map((bot) => bot.name)).toEqual(['Tamu', 'Jabuti']);
    expect(ops.package.teams[0]).toMatchObject({ name: 'Operations', chief: 'tamu' });
    expect(ops.package.rooms[0]).toMatchObject({ title: 'Ops room', lead: 'tamu' });
    expect(ops.package.skills[0]).toMatchObject({ name: 'Refund triage' });
    expect(ops.package.routines[0]).toMatchObject({ name: 'Morning brief', enabled: false });

    expect(STARTER_TEAMS.map(starterTeamSummary)).toEqual([
      expect.objectContaining({ id: 'dev-team', teamCount: 1, botCount: 3, roomCount: 1, routineCount: 1, skillCount: 1 }),
      expect.objectContaining({
        id: 'content-studio',
        teamCount: 1,
        botCount: 3,
        roomCount: 1,
        routineCount: 1,
        skillCount: 1,
      }),
      expect.objectContaining({ id: 'ops-desk', teamCount: 1, botCount: 2, roomCount: 1, routineCount: 1, skillCount: 1 }),
    ]);
    expect(starterTeamSummary(dev).description.length).toBeGreaterThan(0);
  });
});

describe('starter team routes', () => {
  it('lists the starters without touching the database', async () => {
    const response = await call(ctx.app, 'GET', '/api/team-packages/starters');
    expect(response.status).toBe(200);
    const list = await json<Array<{ id: string; name: string; description: string }>>(response);
    expect(list.map((entry) => entry.id)).toEqual(['dev-team', 'content-studio', 'ops-desk']);
    expect(list[0]).toMatchObject({ id: 'dev-team', name: 'Dev team', teamCount: 1, botCount: 3 });
    expect(list[2]).toMatchObject({ id: 'ops-desk', name: 'Ops desk', botCount: 2 });
    expect(await ctx.services.repos.bots.list({ includeArchived: true })).toEqual([]);
    expect(await ctx.services.repos.teams.list()).toEqual([]);
  });

  it('installs the dev team as normal editable bots, team, room, skill and a paused routine', async () => {
    const response = await install('dev-team');
    expect(response.status).toBe(201);
    expect(await json(response)).toEqual({ teams: 1, bots: 3, rooms: 1, routines: 1, skills: 1 });

    const bots = await json<Bot[]>(await call(ctx.app, 'GET', '/api/bots'));
    expect(bots.map((bot) => bot.name)).toEqual(['Capy', 'Onça', 'Lobo']);
    for (const bot of bots) {
      expect(bot.engine).toBe('mock');
      expect(bot.model).toBeUndefined();
      expect(bot.computer).toBe('sandbox');
    }
    const capy = bots.find((bot) => bot.name === 'Capy');
    expect(capy?.job).toBe('Chief of Staff');

    const teams = await json<Team[]>(await call(ctx.app, 'GET', '/api/teams'));
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ name: 'Engineering', chiefBotId: capy?.id });
    expect(bots.every((bot) => bot.teamId === teams[0]?.id)).toBe(true);

    const rooms = await json<Array<{ title: string; leadBotId: string; memberBotIds?: string[]; responder?: string }>>(
      await call(ctx.app, 'GET', '/api/rooms'),
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ title: 'Build room', leadBotId: capy?.id, responder: 'lead' });

    const skills = await json<Skill[]>(await call(ctx.app, 'GET', '/api/skills'));
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'Unified diff' });
    expect(skills[0]?.botId).toBeUndefined();

    const routines = await json<Routine[]>(await call(ctx.app, 'GET', '/api/routines'));
    expect(routines).toHaveLength(1);
    expect(routines[0]).toMatchObject({ name: 'Daily repo check', enabled: false });
    expect(routines[0]?.trigger).toMatchObject({ type: 'cron', cron: '0 9 * * 1-5' });

    // Installed entities are ordinary rows: they can be edited like anything else.
    const patched = await call(ctx.app, 'PATCH', `/api/bots/${capy?.id ?? ''}`, { job: 'Team lead' });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as Bot).job).toBe('Team lead');
  });

  it.each([
    ['content-studio', 3],
    ['ops-desk', 2],
  ])('installs %s with its own counts and paused routines', async (id, botCount) => {
    const response = await install(id);
    expect(response.status).toBe(201);
    expect(await json(response)).toMatchObject({ teams: 1, bots: botCount, rooms: 1, routines: 1, skills: 1 });
    const routines = await json<Routine[]>(await call(ctx.app, 'GET', '/api/routines'));
    expect(routines).toHaveLength(1);
    expect(routines.every((routine) => routine.enabled === false)).toBe(true);
    expect(routines[0]?.nextRunAt).toBeUndefined();
  });

  it('records an admin activity entry for the install and nothing else', async () => {
    expect((await install('dev-team')).status).toBe(201);
    const entries = await json<AdminActivity[]>(await call(ctx.app, 'GET', '/api/activity'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'created',
      targetType: 'team-package',
      targetId: 'dev-team',
      summary: 'Installed starter team "Dev team"',
      actor: 'local',
    });
  });

  it('allows installing the same starter twice', async () => {
    expect((await install('dev-team')).status).toBe(201);
    expect((await install('dev-team')).status).toBe(201);
    const bots = await json<Bot[]>(await call(ctx.app, 'GET', '/api/bots'));
    expect(bots).toHaveLength(6);
    const teams = await json<Team[]>(await call(ctx.app, 'GET', '/api/teams'));
    expect(teams).toHaveLength(2);
    const entries = await json<AdminActivity[]>(await call(ctx.app, 'GET', '/api/activity'));
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.targetId === 'dev-team')).toBe(true);
  });

  it('answers 404 for an unknown starter', async () => {
    const response = await install('no-such-team');
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ error: expect.stringContaining('Starter team') });
    expect(await ctx.services.repos.bots.list({ includeArchived: true })).toEqual([]);
  });
});
