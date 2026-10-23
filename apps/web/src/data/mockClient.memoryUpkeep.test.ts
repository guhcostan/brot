import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A bot with no seeded memories, so the report only sees what the test creates. */
async function freshBot(client: ReturnType<typeof createMockClient>): Promise<string> {
  const bot = await client.createBot({ name: 'Tidy', job: 'Tidy notes', computer: 'none' });
  return bot.id;
}

describe('mock memory upkeep', () => {
  it('finds duplicate notes by kind and normalized content, keeping the newest', async () => {
    const client = createMockClient();
    const botId = await freshBot(client);
    await client.createMemory(botId, { kind: 'fact', content: 'Likes tea.' });
    const newest = await client.createMemory(botId, { kind: 'fact', content: '  likes   TEA. ' });
    await client.createMemory(botId, { kind: 'preference', content: 'Likes tea.' });
    await client.createMemory(botId, { kind: 'fact', content: 'Likes coffee.' });

    const report = await client.getMemoryUpkeep({ scope: 'bot', botId });

    expect(report.total).toBe(4);
    expect(report.removable).toBe(1);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.keep.id).toBe(newest.id);
    expect(report.groups[0]?.remove.map((memory) => memory.content)).toEqual(['Likes tea.']);
  });

  it('scopes the report to workspace facts and ignores other scopes', async () => {
    const client = createMockClient();
    const before = await client.getMemoryUpkeep({ scope: 'workspace' });
    const botId = await freshBot(client);
    await client.createWorkspaceMemory({ kind: 'fact', content: 'Renews in June.' });
    await client.createWorkspaceMemory({ kind: 'fact', content: 'renews in june. ' });
    await client.createMemory(botId, { kind: 'fact', content: 'Renews in June.' });

    const report = await client.getMemoryUpkeep({ scope: 'workspace' });
    expect(report.removable).toBe(before.removable + 1);
    const group = report.groups.find((candidate) => candidate.remove.some((memory) => memory.content === 'Renews in June.'));
    expect(group?.keep.scope).toBe('workspace');
    expect(report.groups.every((candidate) => candidate.keep.scope === 'workspace')).toBe(true);
  });

  it('applies the removals, refreshes the list and journals each deletion', async () => {
    const client = createMockClient();
    const botId = await freshBot(client);
    const older = await client.createMemory(botId, { kind: 'fact', content: 'Likes tea.' });
    await client.createMemory(botId, { kind: 'fact', content: 'Likes tea.' });
    const report = await client.getMemoryUpkeep({ scope: 'bot', botId });
    expect(report.removable).toBe(1);

    await expect(client.applyMemoryUpkeep({ scope: 'bot', botId, removeIds: [older.id] })).resolves.toMatchObject({
      removed: [{ id: older.id }],
    });
    await expect(client.listMemories(botId)).resolves.not.toContainEqual(expect.objectContaining({ id: older.id }));
    const journal = await client.listMemoryJournal({ botId, scope: 'bot' });
    expect(journal[0]).toMatchObject({ action: 'deleted', contentBefore: 'Likes tea.' });
    await expect(client.getMemoryUpkeep({ scope: 'bot', botId })).resolves.toMatchObject({ removable: 0, groups: [] });
  });

  it('refuses ids that are not the removable side of a duplicate group', async () => {
    const client = createMockClient();
    const botId = await freshBot(client);
    const kept = await client.createMemory(botId, { kind: 'fact', content: 'Only one.' });

    await expect(client.applyMemoryUpkeep({ scope: 'bot', botId, removeIds: [kept.id] })).rejects.toThrow('Only duplicates');
    await expect(client.listMemories(botId)).resolves.toContainEqual(expect.objectContaining({ id: kept.id }));
  });
});
