import { describe, expect, it } from 'vitest';
import { createMockClient } from './mockClient';

const GROWTH = 'team_growth';
const CONTENT = 'team_content';

describe('mock teams', () => {
  it('seeds demo teams and groups the demo bots', async () => {
    const client = createMockClient();

    const teams = await client.listTeams();
    expect(teams.map((team) => team.name)).toEqual(['Content', 'Growth']);

    const bots = await client.listBots();
    expect(bots.find((bot) => bot.id === 'bot_capy')?.teamId).toBe(GROWTH);
    expect(bots.find((bot) => bot.id === 'bot_ara')?.teamId).toBe(CONTENT);
    expect(bots.find((bot) => bot.id === 'bot_sol')?.teamId).toBeUndefined();
  });

  it('creates a team with an empty brief by default and rejects an empty name', async () => {
    const client = createMockClient();

    const created = await client.createTeam({ name: 'Ops' });
    expect(created).toMatchObject({ name: 'Ops', instructions: '' });
    expect(created.chiefBotId).toBeUndefined();
    expect((await client.listTeams()).some((team) => team.id === created.id)).toBe(true);

    await expect(client.createTeam({ name: '' })).rejects.toThrow();
  });

  it('updates a team and clears its chief with null', async () => {
    const client = createMockClient();

    const updated = await client.updateTeam(GROWTH, { name: 'Growth Ops', instructions: 'Ship it.' });
    expect(updated).toMatchObject({ name: 'Growth Ops', instructions: 'Ship it.', chiefBotId: 'bot_capy' });

    const cleared = await client.updateTeam(GROWTH, { chiefBotId: null });
    expect(cleared.chiefBotId).toBeUndefined();

    await expect(client.updateTeam(GROWTH, { chiefBotId: 'nobody' })).rejects.toThrow('Unknown bot');
    await expect(client.updateTeam('team_nope', { name: 'x' })).rejects.toThrow('Unknown team');
  });

  it('groups a bot through the API and ungroups it with a null teamId', async () => {
    const client = createMockClient();

    const created = await client.createBot({ name: 'Lobo', job: 'Researcher', computer: 'none', teamId: GROWTH });
    expect(created.teamId).toBe(GROWTH);

    const ungrouped = await client.updateBot(created.id, { teamId: null });
    expect(ungrouped.teamId).toBeUndefined();
  });

  it('deletes a team, ungrouping its bots while keeping them', async () => {
    const client = createMockClient();

    await expect(client.deleteTeam(GROWTH)).resolves.toBeUndefined();

    expect((await client.listTeams()).map((team) => team.id)).toEqual([CONTENT]);
    const bots = await client.listBots({ includeArchived: true });
    expect(bots.find((bot) => bot.id === 'bot_capy')?.teamId).toBeUndefined();
    expect(bots.find((bot) => bot.id === 'bot_onca')?.teamId).toBeUndefined();
    expect(bots.find((bot) => bot.id === 'bot_ara')?.teamId).toBe(CONTENT);
    await expect(client.deleteTeam(GROWTH)).rejects.toThrow('Unknown team');
  });

  it('clears a team chief when its bot is deleted', async () => {
    const client = createMockClient();

    await client.deleteBot('bot_capy');

    expect((await client.listTeams()).find((team) => team.id === GROWTH)?.chiefBotId).toBeUndefined();
  });
});
