import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock starter teams', () => {
  it("matches the server's three built-in starters and their counts", async () => {
    const client = createMockClient();
    const starters = await client.listStarterTeams();

    expect(starters.map((starter) => [starter.id, starter.name, starter.botCount, starter.roomCount, starter.skillCount])).toEqual([
      ['dev-team', 'Dev team', 3, 1, 1],
      ['content-studio', 'Content studio', 3, 1, 1],
      ['ops-desk', 'Ops desk', 2, 1, 1],
    ]);
    for (const starter of starters) {
      expect(starter.description).toBeTruthy();
      expect(starter.teamCount).toBe(1);
      expect(starter.routineCount).toBe(1);
    }
  });

  it('installs the dev team as bots, a team, a lead room, a shared skill and a paused weekday routine', async () => {
    const client = createMockClient();
    const before = {
      bots: (await client.listBots()).length,
      teams: (await client.listTeams()).length,
      rooms: (await client.listRooms()).length,
      routines: (await client.listRoutines()).length,
      skills: (await client.listSkills()).length,
    };

    const counts = await client.installStarterTeam('dev-team');

    expect(counts).toEqual({ bots: 3, teams: 1, rooms: 1, routines: 1, skills: 1 });
    expect((await client.listBots()).map((bot) => bot.name)).toEqual(expect.arrayContaining(['Capy', 'Onça', 'Lobo']));
    const team = (await client.listTeams()).find((entry) => entry.name === 'Engineering');
    expect(team).toBeDefined();
    const installedBots = (await client.listBots()).filter((bot) => bot.teamId === team?.id);
    expect(installedBots.map((bot) => bot.name).sort()).toEqual(['Capy', 'Lobo', 'Onça']);
    const capy = installedBots.find((bot) => bot.name === 'Capy');
    expect(team?.chiefBotId).toBe(capy?.id);
    const room = (await client.listRooms()).find((entry) => entry.thread.title === 'Build room');
    expect(room?.thread.leadBotId).toBe(capy?.id);
    expect(room?.thread.responder).toBe('lead');
    expect(room?.memberIds).toHaveLength(3);
    const skill = (await client.listSkills()).find((entry) => entry.name === 'Unified diff');
    expect(skill?.botId).toBeUndefined();
    const routine = (await client.listRoutines()).find((entry) => entry.name === 'Daily repo check');
    expect(routine).toMatchObject({ enabled: false, trigger: { type: 'cron', cron: '0 9 * * 1-5' } });
    expect(routine?.botId).toBe(installedBots.find((bot) => bot.name === 'Onça')?.id);
    expect((await client.listBots()).length).toBe(before.bots + counts.bots);
    expect((await client.listTeams()).length).toBe(before.teams + counts.teams);
    expect((await client.listRooms()).length).toBe(before.rooms + counts.rooms);
    expect((await client.listRoutines()).length).toBe(before.routines + counts.routines);
    expect((await client.listSkills()).length).toBe(before.skills + counts.skills);
  });

  it('installs the content studio with a mention room and weekly review, and allows duplicates', async () => {
    const client = createMockClient();
    await client.installStarterTeam('content-studio');
    const second = await client.installStarterTeam('content-studio');

    expect(second).toEqual({ bots: 3, teams: 1, rooms: 1, routines: 1, skills: 1 });
    const editorial = (await client.listRooms()).filter((entry) => entry.thread.title === 'Editorial room');
    expect(editorial).toHaveLength(2);
    expect(editorial[0]?.thread.responder).toBe('mention');
    const arara = (await client.listBots()).find((bot) => bot.name === 'Arara');
    expect(editorial[0]?.thread.leadBotId).toBe(arara?.id);
    expect((await client.listRoutines()).filter((routine) => routine.name === 'Weekly content review')).toHaveLength(2);
  });

  it('installs the ops desk with a lead room and Morning brief, and rejects unknown ids', async () => {
    const client = createMockClient();
    const counts = await client.installStarterTeam('ops-desk');

    expect(counts).toEqual({ bots: 2, teams: 1, rooms: 1, routines: 1, skills: 1 });
    const opsTeam = (await client.listTeams()).find((entry) => entry.name === 'Operations');
    const installed = (await client.listBots()).filter((bot) => bot.teamId === opsTeam?.id);
    const tamu = installed.find((bot) => bot.name === 'Tamu');
    const ops = (await client.listRooms()).find((entry) => entry.thread.title === 'Ops room');
    expect(ops?.thread.leadBotId).toBe(tamu?.id);
    expect(ops?.thread.responder).toBe('lead');
    const routine = (await client.listRoutines()).find((entry) => entry.name === 'Morning brief' && entry.botId === tamu?.id);
    expect(routine).toMatchObject({ enabled: false, trigger: { type: 'cron', cron: '0 8 * * 1-5' } });
    await expect(client.installStarterTeam('support-desk')).rejects.toThrow('Unknown starter team');
  });
});
