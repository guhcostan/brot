import type { Team } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const team: Team = {
  id: 'team_growth',
  name: 'Growth',
  instructions: 'Win the Acme renewal.',
  chiefBotId: 'bot_1',
  createdAt: at,
  updatedAt: at,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('team routes', () => {
  it('lists teams from GET /api/teams', async () => {
    const { fetch, calls } = fakeFetch(() => json([team]));
    const client = createHttpClient({ fetch });

    await expect(client.listTeams()).resolves.toEqual([team]);
    expect(calls).toEqual([{ method: 'GET', path: '/api/teams', body: undefined }]);
  });

  it('creates a team with a validated body and returns it', async () => {
    const { fetch, calls } = fakeFetch(() => json(team, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createTeam({ name: 'Growth', chiefBotId: 'bot_1' })).resolves.toEqual(team);
    expect(calls).toEqual([
      { method: 'POST', path: '/api/teams', body: { name: 'Growth', instructions: '', chiefBotId: 'bot_1' } },
    ]);
  });

  it('rejects an invalid team before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(team, 201));
    const client = createHttpClient({ fetch });

    await expect(client.createTeam({ name: '' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('updates a team with PATCH, including removing the chief with null', async () => {
    const withoutChief = { ...team };
    delete withoutChief.chiefBotId;
    const { fetch, calls } = fakeFetch(() => json(withoutChief));
    const client = createHttpClient({ fetch });

    await expect(client.updateTeam('team_growth', { chiefBotId: null, name: 'Operations' })).resolves.toEqual(withoutChief);
    expect(calls).toEqual([{ method: 'PATCH', path: '/api/teams/team_growth', body: { name: 'Operations', chiefBotId: null } }]);
  });

  it('deletes a team with DELETE and accepts the 204', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch });

    await expect(client.deleteTeam('team_growth')).resolves.toBeUndefined();
    expect(calls).toEqual([{ method: 'DELETE', path: '/api/teams/team_growth', body: undefined }]);
  });

  it('surfaces the 400 of a rejected team body', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Invalid request' }, 400));
    const client = createHttpClient({ fetch });

    await expect(client.createTeam({ name: 'Growth' })).rejects.toThrow('400 Invalid request');
    await expect(client.updateTeam('team_growth', { name: 'Growth' })).rejects.toThrow('400 Invalid request');
  });

  it('surfaces the 404 of an unknown team', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Team not found' }, 404));
    const client = createHttpClient({ fetch });

    await expect(client.updateTeam('nope', { name: 'Growth' })).rejects.toThrow('404 Team not found');
    await expect(client.deleteTeam('nope')).rejects.toThrow('404 Team not found');
  });

  it('rejects a team that does not match the protocol', async () => {
    const { fetch } = fakeFetch(() => json([{ id: 'team_growth', name: 'Growth' }]));
    const client = createHttpClient({ fetch });

    await expect(client.listTeams()).rejects.toThrow();
  });
});
