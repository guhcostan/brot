import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base = { name: 'Budget bot', job: 'Researcher', computer: 'none' as const };

describe('mock bot budgets', () => {
  it('persists caps through create, update and list', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, runBudgetUsd: 0.5, dailyBudgetUsd: 2 });
    expect(created).toMatchObject({ runBudgetUsd: 0.5, dailyBudgetUsd: 2 });

    const listed = (await client.listBots()).find((bot) => bot.id === created.id);
    expect(listed).toMatchObject({ runBudgetUsd: 0.5, dailyBudgetUsd: 2 });

    const edited = await client.updateBot(created.id, { runBudgetUsd: 1.25 });
    expect(edited.runBudgetUsd).toBe(1.25);
    expect(edited.dailyBudgetUsd).toBe(2);
  });

  it('omits unset caps and clears with null', async () => {
    const client = createMockClient();
    const created = await client.createBot(base);
    expect(created.runBudgetUsd).toBeUndefined();
    expect(created.dailyBudgetUsd).toBeUndefined();

    await client.updateBot(created.id, { runBudgetUsd: 0.5, dailyBudgetUsd: 2 });
    const cleared = await client.updateBot(created.id, { runBudgetUsd: null, dailyBudgetUsd: null });
    expect(cleared.runBudgetUsd).toBeUndefined();
    expect(cleared.dailyBudgetUsd).toBeUndefined();
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.dailyBudgetUsd).toBeUndefined();
  });

  it('keeps zero, which blocks spending rather than meaning no cap', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, runBudgetUsd: 0, dailyBudgetUsd: 0 });
    expect(created.runBudgetUsd).toBe(0);
    expect(created.dailyBudgetUsd).toBe(0);

    const kept = await client.updateBot(created.id, { name: 'Renamed' });
    expect(kept.runBudgetUsd).toBe(0);
    expect(kept.dailyBudgetUsd).toBe(0);
  });

  it('rejects negative caps and keeps the previous values', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, runBudgetUsd: 0.5 });

    await expect(client.updateBot(created.id, { runBudgetUsd: -1 })).rejects.toThrow();
    await expect(client.createBot({ ...base, name: 'Other', dailyBudgetUsd: -5 })).rejects.toThrow();
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.runBudgetUsd).toBe(0.5);
  });
});
