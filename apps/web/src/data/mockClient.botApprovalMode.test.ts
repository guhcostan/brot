import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base = { name: 'Lobo', job: 'Researcher', computer: 'none' as const };

describe('mock approvalMode', () => {
  it('omits approvalMode for the default ask mode', async () => {
    const client = createMockClient();
    const created = await client.createBot(base);

    expect(created.approvalMode).toBeUndefined();
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.approvalMode).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(created, 'approvalMode')).toBe(false);
  });

  it('persists edits through create and update', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, approvalMode: 'edits' });
    expect(created.approvalMode).toBe('edits');
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.approvalMode).toBe('edits');

    const updated = await client.updateBot(created.id, { approvalMode: 'edits', job: 'Fixer' });
    expect(updated.approvalMode).toBe('edits');
    expect(updated.job).toBe('Fixer');
  });

  it('keeps edits across unrelated patches and clears it when ask is patched', async () => {
    const client = createMockClient();
    const created = await client.createBot({ ...base, approvalMode: 'edits' });

    const renamed = await client.updateBot(created.id, { name: 'Lobinho' });
    expect(renamed.approvalMode).toBe('edits');

    const asked = await client.updateBot(created.id, { approvalMode: 'ask' });
    expect(asked.approvalMode).toBeUndefined();
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.approvalMode).toBeUndefined();
  });

  it('seeded demo bots use the default ask mode', async () => {
    const client = createMockClient();
    const bots = await client.listBots();
    expect(bots.every((bot) => bot.approvalMode === undefined)).toBe(true);
  });
});
