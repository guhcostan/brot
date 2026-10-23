import type { StarterTeamSummary } from '../starterTeams';
import { describe, expect, it } from 'vitest';
import { createHttpClient, type FetchLike } from './httpClient';

const starter: StarterTeamSummary = {
  id: 'dev-team',
  name: 'Dev team',
  description: 'A chief of staff, an engineer and a reviewer who ship together.',
  teamCount: 1,
  botCount: 3,
  roomCount: 1,
  routineCount: 1,
  skillCount: 1,
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const path = new URL(input, 'http://brot.test').pathname;
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? 'GET', path, body });
    return respond({ method: init.method ?? 'GET', path, body });
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('starter team routes', () => {
  it('lists the starter summaries', async () => {
    const { fetch, calls } = fakeFetch(() => json([starter]));
    const client = createHttpClient({ fetch });

    await expect(client.listStarterTeams()).resolves.toEqual([starter]);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/team-packages/starters' });
  });

  it('installs one starter with the id encoded in the path', async () => {
    const counts = { bots: 3, teams: 1, rooms: 1, routines: 1, skills: 1 };
    const { fetch, calls } = fakeFetch(() => json(counts, 201));
    const client = createHttpClient({ fetch });

    await expect(client.installStarterTeam('dev team')).resolves.toEqual(counts);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/team-packages/starters/dev%20team/install',
      body: {},
    });
  });

  it('surfaces a 404 and a 400', async () => {
    const missing = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Starter team not found' }, 404)).fetch });
    await expect(missing.installStarterTeam('nope')).rejects.toThrow('404 Starter team not found');

    const invalid = createHttpClient({ fetch: fakeFetch(() => json({ error: 'Invalid starter' }, 400)).fetch });
    await expect(invalid.installStarterTeam('broken')).rejects.toThrow('400 Invalid starter');
  });

  it('rejects malformed summaries and counts', async () => {
    const badList = createHttpClient({ fetch: fakeFetch(() => json([{ id: 'x' }])).fetch });
    await expect(badList.listStarterTeams()).rejects.toThrow();

    const badCounts = createHttpClient({ fetch: fakeFetch(() => json({ bots: 'two' })).fetch });
    await expect(badCounts.installStarterTeam('dev-team')).rejects.toThrow();
  });
});
