import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_PROVIDERS, createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base = { name: 'Fallback bot', job: 'Researcher', computer: 'none' as const };
const known = DEMO_PROVIDERS.flatMap((provider) => provider.models.map((model) => model.id));

describe('mock bot fallback models', () => {
  it('persists the ordered list through create, update and list', async () => {
    const client = createMockClient();
    const fallbacks = known.slice(0, 2);
    const created = await client.createBot({ ...base, fallbackModels: fallbacks });
    expect(created.fallbackModels).toEqual(fallbacks);

    const listed = (await client.listBots()).find((bot) => bot.id === created.id);
    expect(listed?.fallbackModels).toEqual(fallbacks);

    const reversed = [...fallbacks].reverse();
    const edited = await client.updateBot(created.id, { fallbackModels: reversed });
    expect(edited.fallbackModels).toEqual(reversed);
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.fallbackModels).toEqual(reversed);
  });

  it('omits the field for none and clears it with null', async () => {
    const client = createMockClient();
    const created = await client.createBot(base);
    expect(created.fallbackModels).toBeUndefined();

    await client.updateBot(created.id, { fallbackModels: known.slice(0, 1) });
    const cleared = await client.updateBot(created.id, { fallbackModels: null });
    expect(cleared.fallbackModels).toBeUndefined();
    expect((await client.listBots()).find((bot) => bot.id === created.id)?.fallbackModels).toBeUndefined();
  });

  it('rejects unknown, duplicate or over-long fallback lists', async () => {
    const client = createMockClient();
    const created = await client.createBot(base);

    await expect(client.updateBot(created.id, { fallbackModels: ['vendor/model'] })).rejects.toThrow('Unknown model');
    await expect(client.updateBot(created.id, { fallbackModels: [known[0]!, known[0]!] })).rejects.toThrow('unique');
    await expect(client.updateBot(created.id, { fallbackModels: known.slice(0, 4) })).rejects.toThrow('at most 3');
    await expect(client.createBot({ ...base, name: 'Other', fallbackModels: ['vendor/model'] })).rejects.toThrow('Unknown model');
  });

  it('keeps the fallbacks through unrelated patches', async () => {
    const client = createMockClient();
    const fallbacks = known.slice(0, 2);
    const created = await client.createBot({ ...base, fallbackModels: fallbacks });

    const renamed = await client.updateBot(created.id, { name: 'Renamed', job: 'Fixer' });
    expect(renamed.fallbackModels).toEqual(fallbacks);
  });
});
