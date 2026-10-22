import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSkillFile, parseSkillFile } from '@brot/protocol';
import { skillFileFilename } from '../skillFileName';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const file = formatSkillFile({ name: 'Imported skill', description: 'A test skill.', body: '# Steps\n\n1. Do it.' });

describe('mock skill files', () => {
  it('exports a skill as parseable SKILL.md with a matching filename', async () => {
    const client = createMockClient();
    const skill = (await client.listSkills('bot_capy')).find((entry) => entry.name.length > 0);
    if (!skill) throw new Error('no seeded skill');

    const exported = await client.exportSkill(skill.id);
    expect(exported.filename).toBe(skillFileFilename(skill.name));
    const parsed = parseSkillFile(exported.content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skill).toEqual({ name: skill.name, description: skill.description, body: skill.body });
    expect(exported.filename.endsWith('.SKILL.md')).toBe(true);
  });

  it('imports a bot-scoped skill and a shared skill', async () => {
    const client = createMockClient();
    const scoped = await client.importSkill({ content: file, botId: 'bot_capy' });
    expect(scoped).toMatchObject({ botId: 'bot_capy', name: 'Imported skill', version: 1 });

    const shared = await client.importSkill({ content: file });
    expect(shared.botId).toBeUndefined();

    const capySkills = await client.listSkills('bot_capy');
    expect(capySkills.some((skill) => skill.id === scoped.id)).toBe(true);
    expect(capySkills.some((skill) => skill.id === shared.id)).toBe(true);

    const otherBotSkills = await client.listSkills('bot_onca');
    expect(otherBotSkills.some((skill) => skill.id === shared.id)).toBe(true);
    expect(otherBotSkills.some((skill) => skill.id === scoped.id)).toBe(false);
  });

  it('accepts a JSON skill file and rejects unreadable content or an unknown bot', async () => {
    const client = createMockClient();
    const json = await client.importSkill({ content: JSON.stringify({ name: 'From JSON', description: 'd', body: 'b' }) });
    expect(json.name).toBe('From JSON');

    await expect(client.importSkill({ content: 'not a skill' })).rejects.toThrow('Invalid skill file');
    await expect(client.importSkill({ content: file, botId: 'bot_missing' })).rejects.toThrow();
    await expect(client.exportSkill('missing')).rejects.toThrow();
  });
});
