import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_BOTS } from './fixtures';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const botId = DEMO_BOTS[0]!.id;

describe('mock memory journal', () => {
  it('records created, updated and deleted changes with before/after content', async () => {
    const client = createMockClient();
    const created = await client.createMemory(botId, { kind: 'fact', content: 'Renews in June.' });
    await client.updateMemory(created.id, { content: 'Renews in July.' });
    await client.deleteMemory(created.id);

    const journal = await client.listMemoryJournal({ botId, scope: 'bot' });
    expect(journal.map((entry) => entry.action)).toEqual(['deleted', 'updated', 'created']);
    expect(journal[0]).toMatchObject({ action: 'deleted', contentBefore: 'Renews in July.' });
    expect(journal[1]).toMatchObject({ action: 'updated', contentBefore: 'Renews in June.', contentAfter: 'Renews in July.' });
    expect(journal[2]).toMatchObject({ action: 'created', contentAfter: 'Renews in June.' });
    expect(journal.every((entry) => entry.kind === 'fact' && entry.botId === botId)).toBe(true);
  });

  it('records workspace facts separately and filters by scope/bot/limit', async () => {
    const client = createMockClient();
    const workspace = await client.createWorkspaceMemory({ kind: 'preference', content: 'Likes short updates.' });
    await client.createMemory(botId, { kind: 'fact', content: 'Bot fact.' });

    const onlyWorkspace = await client.listMemoryJournal({ scope: 'workspace' });
    expect(onlyWorkspace.map((entry) => entry.memoryId)).toEqual([workspace.id]);

    const limited = await client.listMemoryJournal({ limit: 1 });
    expect(limited).toHaveLength(1);
    await expect(client.listMemoryJournal({ limit: 0 })).rejects.toThrow();
  });

  it('undoes a created entry by removing the unchanged memory', async () => {
    const client = createMockClient();
    const created = await client.createMemory(botId, { kind: 'fact', content: 'Temporary.' });
    const [entry] = await client.listMemoryJournal({ botId, scope: 'bot' });

    await expect(client.undoMemoryJournal(entry!.id)).resolves.toEqual({ result: 'removed' });
    await expect(client.listMemories(botId)).resolves.not.toContainEqual(expect.objectContaining({ id: created.id }));

    const journal = await client.listMemoryJournal({ botId, scope: 'bot' });
    expect(journal[0]).toMatchObject({ action: 'deleted', contentBefore: 'Temporary.' });
  });

  it('undoes an update only while the memory is unchanged', async () => {
    const client = createMockClient();
    const created = await client.createMemory(botId, { kind: 'fact', content: 'First.' });
    await client.updateMemory(created.id, { content: 'Second.' });
    const journal = await client.listMemoryJournal({ botId, scope: 'bot' });
    const updateEntry = journal.find((entry) => entry.action === 'updated');

    await expect(client.undoMemoryJournal(updateEntry!.id)).resolves.toMatchObject({
      result: 'restored',
      memory: { content: 'First.' },
    });
    await expect(client.listMemories(botId)).resolves.toContainEqual(expect.objectContaining({ id: created.id, content: 'First.' }));

    await client.updateMemory(created.id, { content: 'Third.' });
    await expect(client.undoMemoryJournal(updateEntry!.id)).rejects.toThrow('changed since');
  });

  it('undoes a delete by recreating the memory', async () => {
    const client = createMockClient();
    const created = await client.createMemory(botId, { kind: 'preference', content: 'Bring receipts.' });
    await client.deleteMemory(created.id);
    const journal = await client.listMemoryJournal({ botId, scope: 'bot' });
    const deleteEntry = journal.find((entry) => entry.action === 'deleted');

    await expect(client.undoMemoryJournal(deleteEntry!.id)).resolves.toMatchObject({
      result: 'restored',
      memory: { id: created.id, kind: 'preference', content: 'Bring receipts.' },
    });
    await expect(client.listMemories(botId)).resolves.toContainEqual(expect.objectContaining({ id: created.id, content: 'Bring receipts.' }));
  });

  it('rejects an unknown journal entry', async () => {
    const client = createMockClient();
    await expect(client.undoMemoryJournal('nope')).rejects.toThrow('Unknown journal entry');
  });
});
