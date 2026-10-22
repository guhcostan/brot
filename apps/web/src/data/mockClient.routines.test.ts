import { Routine, RoutineRun } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTINE_MORNING, ROUTINE_SWEEP, ROUTINE_WEEKLY } from './fixtures';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock routines', () => {
  it('seeds only protocol-valid routines and runs', async () => {
    const client = createMockClient();
    for (const routine of await client.listRoutines()) expect(() => Routine.parse(routine)).not.toThrow();
    for (const run of await client.listRoutineRuns()) expect(() => RoutineRun.parse(run)).not.toThrow();
  });

  it('seeds routines with their run receipts, newest first', async () => {
    const client = createMockClient();
    const routines = await client.listRoutines();
    expect(routines.map((routine) => routine.id).sort()).toEqual([ROUTINE_MORNING, ROUTINE_SWEEP, ROUTINE_WEEKLY].sort());

    const morning = await client.listRoutineRuns({ routineId: ROUTINE_MORNING });
    expect(morning.map((run) => run.status)).toEqual(['completed', 'failed', 'completed']);
    expect(morning[0]?.result).toBeTruthy();
    expect(morning[1]?.error).toBeTruthy();

    const sweep = await client.listRoutineRuns({ routineId: ROUTINE_SWEEP });
    expect(sweep[0]).toMatchObject({ status: 'cancelled', trigger: 'schedule' });

    expect((await client.listRoutines('bot_capy')).map((routine) => routine.id)).toEqual([ROUTINE_WEEKLY]);
    expect(await client.listRoutines('bot_nope')).toEqual([]);
  });

  it('creates a routine with the protocol defaults and a next run', async () => {
    const client = createMockClient();
    const created = await client.createRoutine({
      botId: 'bot_sol',
      name: 'Evening wrap',
      instruction: 'Tidy the task board.',
      trigger: { type: 'cron', cron: '0 18 * * 1-5', timezone: 'America/Sao_Paulo' },
    });
    expect(created).toMatchObject({ enabled: true, catchUp: true, rememberLastRun: false });
    expect(created.nextRunAt).toBeDefined();
    expect((await client.listRoutines('bot_sol')).some((routine) => routine.id === created.id)).toBe(true);
    await expect(client.createRoutine({ botId: 'bot_nope', name: 'x', instruction: '', trigger: { type: 'cron', cron: '0 8 * * *' } })).rejects.toThrow();
  });

  it('updates a routine, clearing the next run when it is paused', async () => {
    const client = createMockClient();
    const paused = await client.updateRoutine(ROUTINE_MORNING, { enabled: false });
    expect(paused.enabled).toBe(false);
    expect(paused.nextRunAt).toBeUndefined();

    const renamed = await client.updateRoutine(ROUTINE_MORNING, { name: 'Daily standup brief', catchUp: false, rememberLastRun: true });
    expect(renamed).toMatchObject({ name: 'Daily standup brief', catchUp: false, rememberLastRun: true });
    await expect(client.updateRoutine('nope', { enabled: false })).rejects.toThrow();
  });

  it('deletes a routine with its run history', async () => {
    const client = createMockClient();
    await client.deleteRoutine(ROUTINE_WEEKLY);
    expect((await client.listRoutines()).some((routine) => routine.id === ROUTINE_WEEKLY)).toBe(false);
    expect(await client.listRoutineRuns({ routineId: ROUTINE_WEEKLY })).toEqual([]);
    await expect(client.deleteRoutine('nope')).rejects.toThrow();
  });

  it('runs a routine now, refuses an overlapping run, and records the receipt', async () => {
    const client = createMockClient();
    const before = (await client.listRoutines()).find((routine) => routine.id === ROUTINE_WEEKLY);
    const pending = client.runRoutineNow(ROUTINE_WEEKLY);

    await expect(client.runRoutineNow(ROUTINE_WEEKLY)).rejects.toThrow('409 Routine is already running');
    const { runId } = await pending;
    expect(runId).toBeTruthy();

    const started = await client.listRoutineRuns({ routineId: ROUTINE_WEEKLY });
    expect(started[0]).toMatchObject({ runId, status: 'running', trigger: 'manual' });

    await vi.runAllTimersAsync();
    const finished = await client.listRoutineRuns({ routineId: ROUTINE_WEEKLY });
    expect(finished[0]).toMatchObject({ runId, status: 'completed', trigger: 'manual' });
    expect(finished[0]?.result).toContain('Weekly plan');
    const after = (await client.listRoutines()).find((routine) => routine.id === ROUTINE_WEEKLY);
    expect(after?.lastRunAt).toBeDefined();
    expect(after?.nextRunAt).not.toBe(before?.nextRunAt);
  });

  it('filters runs by bot, status and limit', async () => {
    const client = createMockClient();
    expect((await client.listRoutineRuns({ botId: 'bot_sol' })).every((run) => run.botId === 'bot_sol')).toBe(true);
    expect((await client.listRoutineRuns({ status: 'failed' })).map((run) => run.status)).toEqual(['failed']);
    expect(await client.listRoutineRuns({ limit: 2 })).toHaveLength(2);
    await expect(client.runRoutineNow('nope')).rejects.toThrow('404');
  });
});
