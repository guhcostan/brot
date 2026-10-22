import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock workspace memories', () => {
  it('seeds three facts about the person', async () => {
    const client = createMockClient();
    const memories = await client.listWorkspaceMemories();

    expect(memories).toHaveLength(3);
    expect(memories.every((memory) => memory.scope === 'workspace')).toBe(true);
    expect(memories.every((memory) => memory.botId === undefined)).toBe(true);
    expect(memories.map((memory) => memory.kind)).toEqual(['fact', 'preference', 'fact']);
    expect(memories.map((memory) => memory.content)).toEqual(
      expect.arrayContaining([
        'Prefers Portuguese (pt-BR) in conversation; writes English with customers.',
        'Lives in São Sebastião, on the coast of São Paulo.',
        'Works solo on Brot and does not have a team to delegate to.',
      ]),
    );
  });

  it('creates, edits and deletes a workspace fact', async () => {
    const client = createMockClient();
    const created = await client.createWorkspaceMemory({ kind: 'summary', content: 'Ships on Fridays when possible.' });
    expect(created).toMatchObject({ scope: 'workspace', kind: 'summary', content: 'Ships on Fridays when possible.' });
    expect(created.botId).toBeUndefined();

    const edited = await client.updateMemory(created.id, { content: 'Ships on Thursdays when possible.' });
    expect(edited).toMatchObject({ id: created.id, scope: 'workspace', content: 'Ships on Thursdays when possible.' });

    await client.deleteMemory(created.id);
    expect((await client.listWorkspaceMemories()).some((memory) => memory.id === created.id)).toBe(false);
    await expect(client.updateMemory(created.id, { content: 'x' })).rejects.toThrow();
    await expect(client.deleteMemory(created.id)).rejects.toThrow();
  });

  it('does not leak workspace facts into a bot memory list', async () => {
    const client = createMockClient();
    const created = await client.createWorkspaceMemory({ kind: 'fact', content: 'Likes short meetings.' });

    const capy = await client.listMemories('bot_capy');
    expect(capy.some((memory) => memory.id === created.id)).toBe(false);
    expect(capy.every((memory) => memory.scope === 'bot' && memory.botId === 'bot_capy')).toBe(true);
  });

  it('keeps bot memory CRUD working', async () => {
    const client = createMockClient();
    const created = await client.createMemory('bot_capy', { kind: 'fact', content: 'Uses the task board daily.' });
    expect(created).toMatchObject({ scope: 'bot', botId: 'bot_capy' });

    const edited = await client.updateMemory(created.id, { kind: 'preference' });
    expect(edited).toMatchObject({ scope: 'bot', botId: 'bot_capy', kind: 'preference' });

    await client.deleteMemory(created.id);
    expect((await client.listMemories('bot_capy')).some((memory) => memory.id === created.id)).toBe(false);
  });
});
