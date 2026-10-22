import { parseTeamPackage, type TeamPackage } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewTeamPackage } from '../teamPackagePreview';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const parse = (content: string): TeamPackage => {
  const parsed = parseTeamPackage(content);
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join(', '));
  return parsed.package;
};

describe('mock team packages', () => {
  it('exports a valid whole-workspace package', async () => {
    const client = createMockClient();
    const exported = await client.exportTeamPackage();

    expect(exported.filename).toBe('brot-workspace.md');
    expect(exported.content).toContain('# Brot team package');
    const pkg = parse(exported.content);
    expect(pkg.teams.map((team) => team.name).sort()).toEqual(['Content', 'Growth']);
    expect(pkg.bots.length).toBeGreaterThan(0);
    expect(pkg.rooms.map((room) => room.title).sort()).toEqual(['Acme renewal', 'Launch week']);
    expect(pkg.routines.length).toBeGreaterThan(0);
    expect(pkg.routines.every((routine) => routine.enabled === false)).toBe(true);
    // Shared skills stay behind; bot-scoped ones travel.
    expect(pkg.skills.every((skill) => skill.bot !== undefined)).toBe(true);
  });

  it('scopes a team export to that team and its bots', async () => {
    const client = createMockClient();
    const growth = (await client.listTeams()).find((team) => team.name === 'Growth');
    if (!growth) throw new Error('Growth team missing');

    const exported = await client.exportTeamPackage(growth.id);
    expect(exported.filename).toBe('brot-team-growth.md');
    const pkg = parse(exported.content);
    expect(pkg.teams.map((team) => team.name)).toEqual(['Growth']);
    expect(pkg.bots.every((bot) => bot.team === 't1')).toBe(true);
    expect(pkg.rooms.map((room) => room.title)).toEqual(['Acme renewal']);
    await expect(client.exportTeamPackage('team_missing')).rejects.toThrow();
  });

  it('round-trips an export through import and leaves routines paused', async () => {
    const client = createMockClient();
    const exported = await client.exportTeamPackage();
    const preview = previewTeamPackage(exported.content);
    if (!preview.ok) throw new Error('expected a valid preview');

    const teamsBefore = (await client.listTeams()).length;
    const botsBefore = (await client.listBots()).length;
    const counts = await client.importTeamPackage(exported.content);

    expect(counts).toEqual(preview.preview.counts);
    expect((await client.listTeams()).length).toBe(teamsBefore + counts.teams);
    const bots = await client.listBots();
    expect(bots.length).toBe(botsBefore + counts.bots);
    // Imported bots get host defaults: no model, no computer credentials, sandbox computer.
    for (const bot of bots.slice(botsBefore)) {
      expect(bot.model).toBeUndefined();
      expect(bot.browser).not.toBe(true);
    }
    const routines = await client.listRoutines();
    expect(routines.length).toBeGreaterThanOrEqual(counts.routines);
    expect(routines.filter((routine) => routine.enabled === false).length).toBeGreaterThanOrEqual(counts.routines);
    expect((await client.listSkills()).length).toBeGreaterThanOrEqual(counts.skills);
  });

  it('refuses an invalid package and a team scope without bots', async () => {
    const client = createMockClient();
    await expect(client.importTeamPackage('not a package')).rejects.toThrow('Invalid team package');
    const empty = await client.createTeam({ name: 'Empty', instructions: '' });
    await expect(client.exportTeamPackage(empty.id)).rejects.toThrow();
  });
});
