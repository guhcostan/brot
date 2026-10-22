import type { CreateBotInput, UpdateBot } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const botById = async (client: ReturnType<typeof createMockClient>, botId: string) => {
  const bot = (await client.listBots({ includeArchived: true })).find((entry) => entry.id === botId);
  if (!bot) throw new Error(`${botId} missing`);
  return bot;
};

const hostBrowserBot = (extra: Partial<CreateBotInput> = {}): CreateBotInput => ({
  name: 'Lobo',
  job: 'Researcher',
  computer: 'none',
  browser: true,
  ...extra,
});

describe('mock browser profiles', () => {
  it('seeds two shared profiles and which demo bots use them', async () => {
    const client = createMockClient();
    expect((await client.listBrowserProfiles()).map((profile) => profile.name)).toEqual(['Promoções', 'Shared accounts']);
    expect((await botById(client, 'bot_tuca')).browserProfileId).toBe('profile_shared');
    expect((await botById(client, 'bot_mico')).browserProfileId).toBe('profile_promo');

    const status = await client.browserStatus('bot_tuca');
    expect(status).toEqual({ state: 'stopped', profile: { kind: 'shared', id: 'profile_shared', name: 'Shared accounts' } });
    expect((await client.browserStatus('bot_mico')).profile).toEqual({ kind: 'shared', id: 'profile_promo', name: 'Promoções' });
  });

  it('creates, renames and deletes profiles', async () => {
    const client = createMockClient();
    const created = await client.createBrowserProfile({ name: '  Support logins ' });
    expect(created.name).toBe('Support logins');
    expect((await client.listBrowserProfiles()).some((profile) => profile.id === created.id)).toBe(true);

    const renamed = await client.updateBrowserProfile(created.id, { name: 'Support' });
    expect(renamed.name).toBe('Support');

    await client.deleteBrowserProfile(created.id);
    expect((await client.listBrowserProfiles()).some((profile) => profile.id === created.id)).toBe(false);
    await expect(client.updateBrowserProfile(created.id, { name: 'x' })).rejects.toThrow();
    await expect(client.deleteBrowserProfile(created.id)).rejects.toThrow();
    await expect(client.createBrowserProfile({ name: '   ' })).rejects.toThrow();
  });

  it('ungroups bots when their shared profile is deleted, falling them back to their own profile', async () => {
    const client = createMockClient();
    await client.deleteBrowserProfile('profile_shared');

    const tuca = await botById(client, 'bot_tuca');
    expect(tuca.browserProfileId).toBeUndefined();
    expect(await client.browserStatus('bot_tuca')).toEqual({ state: 'stopped', profile: { kind: 'own' } });
  });

  it('shares one browser session between the bots of a profile', async () => {
    const client = createMockClient();
    const a = await client.createBot(hostBrowserBot({ name: 'A', browserProfileId: 'profile_shared' }));
    const b = await client.createBot(hostBrowserBot({ name: 'B', browserProfileId: 'profile_shared' }));
    expect(a.browserProfileId).toBe('profile_shared');
    expect((await client.browserStatus(b.id)).profile).toEqual({ kind: 'shared', id: 'profile_shared', name: 'Shared accounts' });

    await client.startBrowserLogin(a.id);
    expect((await client.browserStatus(a.id)).state).toBe('login');
    expect((await client.browserStatus(b.id)).state).toBe('login');
    expect((await client.browserStatus('bot_tuca')).state).toBe('login');

    await client.closeBrowser(b.id);
    expect((await client.browserStatus(a.id)).state).toBe('stopped');
    expect((await client.browserStatus('bot_tuca')).state).toBe('stopped');
  });

  it('moves a bot between its own profile and a shared one with PATCH, rejecting unknown profiles', async () => {
    const client = createMockClient();
    const bot = await client.createBot(hostBrowserBot({ name: 'C' }));
    expect((await client.browserStatus(bot.id)).profile).toEqual({ kind: 'own' });

    const shared: UpdateBot = { browserProfileId: 'profile_promo' };
    await client.updateBot(bot.id, shared);
    expect((await client.browserStatus(bot.id)).profile).toEqual({ kind: 'shared', id: 'profile_promo', name: 'Promoções' });

    const own: UpdateBot = { browserProfileId: null };
    await client.updateBot(bot.id, own);
    expect((await client.browserStatus(bot.id)).profile).toEqual({ kind: 'own' });

    await expect(client.updateBot(bot.id, { browserProfileId: 'nope' })).rejects.toThrow();
    await expect(client.createBot(hostBrowserBot({ browserProfileId: 'nope' }))).rejects.toThrow();
  });
});
