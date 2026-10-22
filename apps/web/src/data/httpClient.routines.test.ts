import type { Routine, RoutineRun } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { createHttpClient, parseRunStarted, type FetchLike } from './httpClient';

const at = '2026-10-19T09:00:00.000Z';

const routine: Routine = {
  id: 'routine_1',
  botId: 'bot_1',
  name: 'Morning brief',
  instruction: 'Summarize overnight email.',
  trigger: { type: 'cron', cron: '0 8 * * 1-5', timezone: 'America/Sao_Paulo' },
  enabled: true,
  catchUp: true,
  rememberLastRun: false,
  lastRunAt: at,
  nextRunAt: at,
  createdAt: at,
  updatedAt: at,
};

const run: RoutineRun = {
  id: 'rr_1',
  routineId: 'routine_1',
  botId: 'bot_1',
  threadId: 'thr_1',
  runId: 'run_1',
  trigger: 'schedule',
  status: 'completed',
  result: 'Three priorities.',
  startedAt: at,
  endedAt: at,
  createdAt: at,
};

interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input, 'http://brot.test');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('routine routes', () => {
  it('lists every routine, or one bot routines', async () => {
    const { fetch, calls } = fakeFetch(() => json([routine]));
    const client = createHttpClient({ fetch });

    await expect(client.listRoutines()).resolves.toEqual([routine]);
    await client.listRoutines('bot_1');

    expect(calls.map((call) => `${call.path}${call.search}`)).toEqual(['/api/routines', '/api/routines?botId=bot_1']);
  });

  it('creates a routine with the protocol defaults filled in', async () => {
    const { fetch, calls } = fakeFetch(() => json(routine, 201));
    const client = createHttpClient({ fetch });

    await expect(
      client.createRoutine({
        botId: 'bot_1',
        name: 'Morning brief',
        instruction: 'Summarize overnight email.',
        trigger: { type: 'cron', cron: '0 8 * * 1-5', timezone: 'America/Sao_Paulo' },
      }),
    ).resolves.toEqual(routine);

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/routines' });
    expect(calls[0]?.body).toEqual({
      botId: 'bot_1',
      name: 'Morning brief',
      instruction: 'Summarize overnight email.',
      trigger: { type: 'cron', cron: '0 8 * * 1-5', timezone: 'America/Sao_Paulo' },
      enabled: true,
      catchUp: true,
      rememberLastRun: false,
    });
  });

  it('rejects an unnamed routine before any request', async () => {
    const { fetch, calls } = fakeFetch(() => json(routine, 201));
    const client = createHttpClient({ fetch });

    await expect(
      client.createRoutine({ botId: 'bot_1', name: '', instruction: '', trigger: { type: 'cron', cron: '0 8 * * *' } }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('updates a routine with PATCH', async () => {
    const paused = { ...routine, enabled: false };
    const { fetch, calls } = fakeFetch(() => json(paused));
    const client = createHttpClient({ fetch });

    await expect(client.updateRoutine('routine_1', { enabled: false })).resolves.toEqual(paused);
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/routines/routine_1', body: { enabled: false } });
  });

  it('deletes a routine and accepts the 204', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createHttpClient({ fetch });

    await expect(client.deleteRoutine('routine_1')).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/routines/routine_1' });
  });

  it('runs a routine now and returns the started run id', async () => {
    const { fetch, calls } = fakeFetch(() => json({ runId: 'run_9' }, 202));
    const client = createHttpClient({ fetch });

    await expect(client.runRoutineNow('routine_1')).resolves.toEqual({ runId: 'run_9' });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/routines/routine_1/run' });
  });

  it('surfaces the 409 when the routine is already running', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Routine is already running' }, 409));
    const client = createHttpClient({ fetch });

    await expect(client.runRoutineNow('routine_1')).rejects.toThrow('409 Routine is already running');
  });

  it('lists runs through the query string, newest first from the server', async () => {
    const { fetch, calls } = fakeFetch(() => json([run]));
    const client = createHttpClient({ fetch });

    await expect(client.listRoutineRuns({ routineId: 'routine_1', status: 'completed', limit: 10 })).resolves.toEqual([run]);
    expect(calls[0]?.path).toBe('/api/routine-runs');
    expect(calls[0]?.search).toBe('?routineId=routine_1&status=completed&limit=10');

    await client.listRoutineRuns();
    expect(calls[1]?.search).toBe('');
  });

  it('surfaces the server validation message for an invalid cron or timezone', async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: 'Invalid request', issues: [{ path: ['trigger', 'cron'], message: 'Invalid cron pattern: nope' }] }, 400),
    );
    const client = createHttpClient({ fetch });

    await expect(
      client.createRoutine({ botId: 'bot_1', name: 'Bad', instruction: '', trigger: { type: 'cron', cron: 'nope' } }),
    ).rejects.toThrow('400 Invalid request: Invalid cron pattern: nope');
  });

  it('surfaces the 404 of an unknown routine', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'Routine not found' }, 404));
    const client = createHttpClient({ fetch });

    await expect(client.updateRoutine('nope', { enabled: false })).rejects.toThrow('404 Routine not found');
    await expect(client.deleteRoutine('nope')).rejects.toThrow('404 Routine not found');
    await expect(client.runRoutineNow('nope')).rejects.toThrow('404 Routine not found');
  });

  it('rejects a routine list and run list that do not match the protocol', async () => {
    const { fetch } = fakeFetch(() => json([{ id: 'routine_1' }]));
    const client = createHttpClient({ fetch });

    await expect(client.listRoutines()).rejects.toThrow();
    await expect(client.listRoutineRuns()).rejects.toThrow();
  });
});

describe('parseRunStarted', () => {
  it('accepts a run id and rejects anything else', () => {
    expect(parseRunStarted({ runId: 'run_1' })).toEqual({ runId: 'run_1' });
    expect(() => parseRunStarted({})).toThrow();
    expect(() => parseRunStarted(null)).toThrow();
    expect(() => parseRunStarted({ runId: 3 })).toThrow();
  });
});
