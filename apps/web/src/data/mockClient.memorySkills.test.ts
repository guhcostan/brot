import { Memory, Skill } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock memories', () => {
  it('seeds bot memories, oldest first', async () => {
    const client = createMockClient();
    const capy = await client.listMemories('bot_capy');
    expect(capy.map((memory) => memory.kind).sort()).toEqual(['fact', 'preference']);
    expect(capy[0]?.content).toContain('short summaries');
    for (const memory of capy) expect(() => Memory.parse(memory)).not.toThrow();
    expect(await client.listMemories('bot_mico')).toEqual([]);
    await expect(client.listMemories('bot_nope')).rejects.toThrow();
  });

  it('creates, updates and deletes a memory', async () => {
    const client = createMockClient();
    const created = await client.createMemory('bot_sol', { kind: 'fact', content: 'The demo is on Friday.' });
    expect(() => Memory.parse(created)).not.toThrow();
    expect((await client.listMemories('bot_sol')).some((memory) => memory.id === created.id)).toBe(true);

    const updated = await client.updateMemory(created.id, { kind: 'preference', content: 'Keep Fridays free after 15:00.' });
    expect(updated).toMatchObject({ kind: 'preference', content: 'Keep Fridays free after 15:00.' });

    await client.deleteMemory(created.id);
    expect((await client.listMemories('bot_sol')).some((memory) => memory.id === created.id)).toBe(false);
    await expect(client.updateMemory('nope', { content: 'x' })).rejects.toThrow();
    await expect(client.deleteMemory('nope')).rejects.toThrow();
    await expect(client.createMemory('bot_nope', { kind: 'fact', content: 'x' })).rejects.toThrow();
  });
});

describe('mock skills', () => {
  it('lists all skills, or a bot own plus shared ones, by name', async () => {
    const client = createMockClient();
    const all = await client.listSkills();
    expect(all.map((skill) => skill.name)).toEqual(['Customer follow-up', 'Refund triage', 'Weekly plan']);
    for (const skill of all) expect(() => Skill.parse(skill)).not.toThrow();

    const capy = await client.listSkills('bot_capy');
    expect(capy.map((skill) => skill.name)).toEqual(['Customer follow-up', 'Weekly plan']);
    expect(capy.find((skill) => skill.name === 'Weekly plan')?.botId).toBeUndefined();
    expect((await client.listSkills('bot_boto')).map((skill) => skill.name)).toEqual(['Weekly plan']);
    await expect(client.listSkills('bot_nope')).rejects.toThrow();
  });

  it('creates a bot skill and a shared skill', async () => {
    const client = createMockClient();
    const owned = await client.createSkill({ botId: 'bot_sol', name: 'Inbox sweep', description: 'Sort the inbox.', body: '# Sweep' });
    const shared = await client.createSkill({ name: 'Release note', description: 'Draft a release note.', body: '# Release' });
    expect(owned).toMatchObject({ botId: 'bot_sol', version: 1 });
    expect(shared.botId).toBeUndefined();
    expect((await client.listSkills('bot_sol')).map((skill) => skill.name)).toContain('Inbox sweep');
    expect((await client.listSkills('bot_tuca')).map((skill) => skill.name)).toContain('Release note');
    await expect(client.createSkill({ botId: 'bot_nope', name: 'x', description: '', body: '' })).rejects.toThrow();
  });

  it('updates a skill, bumping its version, and deletes it', async () => {
    const client = createMockClient();
    const updated = await client.updateSkill('skill_refund', { description: 'Only when the order is over 30 days old.' });
    expect(updated.version).toBe(2);
    expect(updated.description).toContain('30 days');
    await expect(client.updateSkill('nope', { name: 'x' })).rejects.toThrow();

    await client.deleteSkill('skill_refund');
    expect((await client.listSkills()).some((skill) => skill.id === 'skill_refund')).toBe(false);
    await expect(client.deleteSkill('nope')).rejects.toThrow();
  });

  it('removes a deleted bot memories and skills', async () => {
    const client = createMockClient();
    const bot = await client.createBot({ name: 'Lobo', job: 'Researcher', computer: 'none' });
    await client.createMemory(bot.id, { kind: 'fact', content: 'Likes primary sources.' });
    await client.createSkill({ botId: bot.id, name: 'Source check', description: 'Verify a source.', body: '# Check' });

    await client.deleteBot(bot.id);

    await expect(client.listMemories(bot.id)).rejects.toThrow();
    expect((await client.listSkills()).some((skill) => skill.name === 'Source check')).toBe(false);
  });
});
