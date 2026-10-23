import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock bot presets', () => {
  it('seeds two presets with avatars', async () => {
    const client = createMockClient();
    const presets = await client.listBotPresets();

    expect(presets.map((preset) => preset.name)).toEqual(['Social media manager', 'Support triage']);
    expect(presets.every((preset) => preset.avatar !== undefined)).toBe(true);
    expect(presets.find((preset) => preset.name === 'Support triage')?.job.length).toBeGreaterThan(0);
    expect(presets.find((preset) => preset.name === 'Support triage')?.instructions.length).toBeGreaterThan(0);
  });

  it('creates, edits and deletes a preset', async () => {
    const client = createMockClient();
    const created = await client.createBotPreset({ name: '  Ops bot  ', job: '  Keep things running.  ', instructions: 'Observe.' });
    expect(created).toMatchObject({ name: 'Ops bot', job: 'Keep things running.', instructions: 'Observe.' });
    expect(created.id).toBeTruthy();

    const edited = await client.updateBotPreset(created.id, { name: 'Ops bot 2', avatar: 'onca:teal' });
    expect(edited).toMatchObject({ name: 'Ops bot 2', avatar: 'onca:teal', job: 'Keep things running.' });

    await client.deleteBotPreset(created.id);
    expect((await client.listBotPresets()).some((preset) => preset.id === created.id)).toBe(false);
    await expect(client.updateBotPreset(created.id, { name: 'x' })).rejects.toThrow();
    await expect(client.deleteBotPreset(created.id)).rejects.toThrow();
  });

  it('rejects a blank name or job', async () => {
    const client = createMockClient();
    await expect(client.createBotPreset({ name: '', job: 'Job' })).rejects.toThrow();
    await expect(client.createBotPreset({ name: 'Name', job: '' })).rejects.toThrow();
  });

  it('copies a bot into a preset with its name, job, instructions and avatar', async () => {
    const client = createMockClient();
    const bot = await client.createBot({
      name: 'Lobo',
      job: 'Watch the backlog.',
      instructions: 'Report blockers.',
      avatar: 'lobo:teal',
      computer: 'none',
    });
    const copied = await client.createPresetFromBot(bot.id);
    expect(copied).toMatchObject({ name: 'Lobo', job: 'Watch the backlog.', instructions: 'Report blockers.', avatar: 'lobo:teal' });

    const renamed = await client.createPresetFromBot(bot.id, { name: 'Backup Lobo' });
    expect(renamed.name).toBe('Backup Lobo');

    await expect(client.createPresetFromBot('bot_missing')).rejects.toThrow('Unknown bot');
  });

  it('keeps presets independent of the bots they came from', async () => {
    const client = createMockClient();
    const bot = await client.createBot({ name: 'Lobo', job: 'Watch.', computer: 'none' });
    const copied = await client.createPresetFromBot(bot.id);

    await client.updateBot(bot.id, { job: 'Changed later.' });
    const presets = await client.listBotPresets();
    expect(presets.find((preset) => preset.id === copied.id)?.job).toBe('Watch.');
  });
});
