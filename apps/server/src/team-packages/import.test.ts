import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Repos } from '@brot/db';
import {
  TEAM_PACKAGE_IMPORT_MAX_CHARS,
  TeamPackage,
  type Bot,
  type Routine,
  type Skill,
  type Team,
} from '@brot/protocol';
import { importTeamPackage } from './import';
import { call, createTestContext, recordEvents, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const repos = (): Repos => ctx.services.repos;

async function counts(): Promise<{ teams: number; bots: number; rooms: number; routines: number; skills: number }> {
  return {
    teams: (await repos().teams.list()).length,
    bots: (await repos().bots.list()).length,
    rooms: (await repos().threads.listRooms()).length,
    routines: (await repos().routines.list()).length,
    skills: (await repos().skills.list()).length,
  };
}

async function importPackage(content: string): Promise<Response> {
  return call(ctx.app, 'POST', '/api/team-packages/import', { content });
}

const exportedAt = '2026-10-22T12:00:00.000Z';

function minimalPackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'brot.team',
    version: 1,
    exportedAt,
    teams: [],
    bots: [{ key: 'b1', name: 'Ada', job: 'Researcher', instructions: 'Be brief.' }],
    rooms: [],
    routines: [],
    skills: [],
    ...overrides,
  };
}

interface SourceEntities {
  growth: Team;
  ada: Bot;
  grace: Bot;
  capy: Bot;
  digest: Routine;
  triage: Skill;
}

/** The same setup an exported workspace needs: a team, a chief, a room, routines and skills. */
async function seedSource(source: TestContext): Promise<SourceEntities> {
  const sourceRepos = source.services.repos;
  const growth = await sourceRepos.teams.create({ name: 'Growth', instructions: 'Ship weekly.' });
  const ada = await sourceRepos.bots.create({
    name: 'Ada',
    job: 'Lead',
    instructions: 'Lead the team.',
    teamId: growth.id,
    avatar: 'capivara:black',
    engine: 'dsh',
    model: 'openai/gpt',
    computer: 'none',
    browser: true,
    teamBudgetUsd: 5,
    egress: { mode: 'allowlist', allow: ['api.example.com'] },
  });
  const grace = await sourceRepos.bots.create({ name: 'Grace', job: 'Ops', instructions: 'Keep it up.', teamId: growth.id });
  const capy = await sourceRepos.bots.create({ name: 'Capy', job: 'Chief', instructions: 'Calm.' });
  await sourceRepos.teams.update(growth.id, { chiefBotId: ada.id });
  await sourceRepos.rooms.create({
    title: 'Launch room',
    botIds: [ada.id, grace.id],
    leadBotId: ada.id,
    responder: 'mention',
  });
  const digest = await sourceRepos.routines.create({
    botId: ada.id,
    name: 'Digest',
    instruction: 'Summarise the day.',
    trigger: { type: 'cron', cron: '0 9 * * *', timezone: 'UTC' },
    catchUp: false,
    rememberLastRun: true,
  });
  await sourceRepos.routines.create({
    botId: capy.id,
    name: 'Standup',
    instruction: 'Stand up.',
    trigger: { type: 'cron', cron: '0 8 * * 1' },
  });
  const triage = await sourceRepos.skills.create({ name: 'Triage', description: 'Sort the inbox', body: '# Triage', botId: ada.id });
  await sourceRepos.routines.create({
    botId: ada.id,
    name: 'Deploy hook',
    instruction: 'Never exported.',
    trigger: { type: 'webhook', secret: 'webhook-secret' },
  });
  await sourceRepos.skills.create({ name: 'Shared style', description: 'Never exported either', body: '# Style' });
  return { growth, ada, grace, capy, digest, triage };
}

describe('POST /api/team-packages/import', () => {
  it('round-trips an export into a fresh database with mapped relationships and safe defaults', async () => {
    const source = await createTestContext();
    try {
      const seeded = await seedSource(source);
      const exported = await call(source.app, 'GET', '/api/team-packages/export');
      expect(exported.status).toBe(200);
      const content = await exported.text();

      const events = recordEvents(ctx.services.bus);
      const res = await importPackage(content);
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ teams: 1, bots: 3, rooms: 1, routines: 2, skills: 1 });
      expect(events.list).toEqual([]);
      events.stop();

      const teams = await repos().teams.list();
      expect(teams).toHaveLength(1);
      expect(teams[0]).toMatchObject({ name: 'Growth', instructions: 'Ship weekly.' });

      const bots = await repos().bots.list();
      expect(bots.map((bot) => bot.name).sort()).toEqual(['Ada', 'Capy', 'Grace']);
      const ada = bots.find((bot) => bot.name === 'Ada');
      const grace = bots.find((bot) => bot.name === 'Grace');
      const capy = bots.find((bot) => bot.name === 'Capy');
      if (ada === undefined || grace === undefined || capy === undefined) throw new Error('an imported bot is missing');

      // Host choices do not travel: the imported bot gets the server defaults.
      expect(ada).toMatchObject({ engine: 'mock', computer: 'sandbox', avatar: 'capivara:black', teamId: teams[0]?.id });
      expect(ada.model).toBeUndefined();
      expect(ada.browser).toBeUndefined();
      expect(ada.teamBudgetUsd).toBeUndefined();
      expect(ada.egress).toEqual({ mode: 'deny', allow: [] });
      expect(capy.teamId).toBeUndefined();
      expect(teams[0]?.chiefBotId).toBe(ada.id);

      const rooms = await repos().threads.listRooms();
      expect(rooms).toHaveLength(1);
      expect(rooms[0]).toMatchObject({ title: 'Launch room', leadBotId: ada.id, responder: 'mention' });
      const room = rooms[0];
      if (room === undefined) throw new Error('the imported room is missing');
      const members = await repos().rooms.listMembers(room.id);
      expect(members.map((member) => member.botId).sort()).toEqual([ada.id, grace.id].sort());

      const routines = await repos().routines.list();
      expect(routines.map((routine) => routine.name).sort()).toEqual(['Digest', 'Standup']);
      expect(routines.every((routine) => routine.enabled === false)).toBe(true);
      const digest = routines.find((routine) => routine.name === 'Digest');
      expect(digest).toMatchObject({ botId: ada.id, catchUp: false, rememberLastRun: true });
      expect(digest?.trigger).toEqual({ type: 'cron', cron: '0 9 * * *', timezone: 'UTC' });

      const skills = await repos().skills.list();
      expect(skills.map((skill) => skill.name)).toEqual(['Triage']);
      expect(skills[0]?.botId).toBe(ada.id);

      // Nothing points at the source database.
      expect(bots.some((bot) => bot.id === seeded.ada.id)).toBe(false);
      expect(teams[0]?.id).not.toBe(seeded.growth.id);
    } finally {
      await source.close();
    }
  });

  it('imports raw JSON, pauses a routine that claims to be enabled, and keeps shared skills shared', async () => {
    const res = await importPackage(
      JSON.stringify(
        minimalPackage({
          routines: [{ bot: 'b1', name: 'Tick', instruction: 'Tick.', cron: '*/5 * * * *', enabled: true }],
          skills: [{ name: 'Global', description: 'Everyone', body: '# Global' }],
        }),
      ),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ teams: 0, bots: 1, rooms: 0, routines: 1, skills: 1 });

    const [routine] = await repos().routines.list();
    expect(routine).toMatchObject({ name: 'Tick', enabled: false });
    const [skill] = await repos().skills.list();
    expect(skill?.botId).toBeUndefined();
  });

  it('preserves the auto responder mode from a package', async () => {
    const res = await importPackage(
      JSON.stringify(
        minimalPackage({
          bots: [
            { key: 'b1', name: 'Ada', job: 'Lead', instructions: '' },
            { key: 'b2', name: 'Grace', job: 'Ops', instructions: '' },
          ],
          rooms: [{ title: 'Launch', lead: 'b1', members: ['b1', 'b2'], responder: 'auto' }],
        }),
      ),
    );
    expect(res.status).toBe(201);
    const [room] = await repos().threads.listRooms();
    expect(room?.responder).toBe('auto');
  });

  it('keeps accepting an older package whose room has no responder', async () => {
    const res = await importPackage(
      JSON.stringify(
        minimalPackage({
          bots: [
            { key: 'b1', name: 'Ada', job: 'Lead', instructions: '' },
            { key: 'b2', name: 'Grace', job: 'Ops', instructions: '' },
          ],
          rooms: [{ title: 'Launch', lead: 'b1', members: ['b1', 'b2'] }],
        }),
      ),
    );
    expect(res.status).toBe(201);
    const [room] = await repos().threads.listRooms();
    expect(room?.responder).toBe('lead');
  });

  it('omits an avatar that does not fit the stored species:color form', async () => {
    const res = await importPackage(
      JSON.stringify(minimalPackage({ bots: [{ key: 'b1', name: 'Ada', job: 'Researcher', instructions: '', avatar: 'not an avatar!' }] })),
    );
    expect(res.status).toBe(201);
    const [bot] = await repos().bots.list();
    expect(bot?.avatar).toBeUndefined();
  });

  it('rejects malformed, unsupported, oversize and bad-reference packages without writing anything', async () => {
    const before = await counts();

    const malformed = await importPackage('{"format":"brot.team"}');
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { issues: { path: (string | number)[] }[] }).issues.length).toBeGreaterThan(0);

    expect((await importPackage('# Brot team package\n\nno block')).status).toBe(400);
    expect((await importPackage(JSON.stringify(minimalPackage({ version: 9 })))).status).toBe(400);
    expect((await importPackage('x'.repeat(TEAM_PACKAGE_IMPORT_MAX_CHARS + 1))).status).toBe(400);

    const hugeBody = 'y'.repeat(1_100_000);
    const oversize = await importPackage(
      JSON.stringify(minimalPackage({ skills: [{ name: 'Huge', description: '', body: hugeBody }] })),
    );
    expect(oversize.status).toBe(400);
    expect(((await oversize.json()) as { issues: { message: string }[] }).issues[0]?.message).toMatch(/bytes/);

    const dangling = await importPackage(
      JSON.stringify(minimalPackage({ routines: [{ bot: 'b9', name: 'Nope', instruction: '', cron: '0 9 * * *', enabled: false }] })),
    );
    expect(dangling.status).toBe(400);
    expect(((await dangling.json()) as { issues: { path: (string | number)[] }[] }).issues[0]?.path).toEqual([
      'routines',
      0,
      'bot',
    ]);

    const badCron = await importPackage(
      JSON.stringify(minimalPackage({ routines: [{ bot: 'b1', name: 'Nope', instruction: '', cron: 'every tuesday', enabled: false }] })),
    );
    expect(badCron.status).toBe(400);
    expect(((await badCron.json()) as { issues: { path: (string | number)[] }[] }).issues[0]?.path).toEqual([
      'routines',
      0,
      'cron',
    ]);

    expect(await counts()).toEqual(before);
  });

  it('rolls back a failed import, removing the teams, bots, rooms, routines and skills it created', async () => {
    const pkg = TeamPackage.parse(
      minimalPackage({
        teams: [{ key: 't1', name: 'Growth', instructions: 'Ship.', chief: 'b1' }],
        bots: [
          { key: 'b1', name: 'Ada', job: 'Lead', instructions: '', team: 't1' },
          { key: 'b2', name: 'Grace', job: 'Ops', instructions: '', team: 't1' },
        ],
        rooms: [{ title: 'Launch', lead: 'b1', members: ['b1', 'b2'] }],
        routines: [{ bot: 'b1', name: 'Digest', instruction: '', cron: '0 9 * * *', enabled: false }],
        skills: [{ name: 'Triage', description: '', body: '', bot: 'b1' }],
      }),
    );
    const failing: Repos = {
      ...repos(),
      skills: {
        ...repos().skills,
        create: async () => {
          throw new Error('disk full');
        },
      },
    };

    await expect(importTeamPackage(failing, pkg)).rejects.toThrow('disk full');

    expect(await repos().bots.list()).toEqual([]);
    expect(await repos().teams.list()).toEqual([]);
    expect(await repos().routines.list()).toEqual([]);
    expect(await repos().skills.list()).toEqual([]);
    expect(await repos().threads.listRooms()).toEqual([]);
  });
});
