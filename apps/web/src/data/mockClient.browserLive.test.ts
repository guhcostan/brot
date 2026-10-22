import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenUnavailable } from './client';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const hostBot = async (client: ReturnType<typeof createMockClient>, name: string, browserProfileId?: string) =>
  client.createBot({
    name,
    job: 'Researcher',
    computer: 'none',
    browser: true,
    ...(browserProfileId === undefined ? {} : { browserProfileId }),
  });

describe('mock browser live view', () => {
  it('returns a placeholder JPEG and lazily starts the browser', async () => {
    const client = createMockClient();
    const bot = await hostBot(client, 'Lobo');
    expect((await client.browserStatus(bot.id)).state).toBe('stopped');

    const frame = await client.browserScreen(bot.id);
    expect(frame.type).toBe('image/jpeg');
    expect((await client.browserStatus(bot.id)).state).toBe('running');
  });

  it('refuses the screen while the sign-in window is open and for a bot without a browser', async () => {
    const client = createMockClient();
    const bot = await hostBot(client, 'Lobo');
    await client.startBrowserLogin(bot.id);

    const login = await client.browserScreen(bot.id).catch((error: unknown) => error);
    expect(login).toBeInstanceOf(ScreenUnavailable);
    expect((login as ScreenUnavailable).status).toBe(409);

    const noBrowser = await client.browserScreen('bot_capy').catch((error: unknown) => error);
    expect(noBrowser).toBeInstanceOf(ScreenUnavailable);
  });

  it('refuses input until control is taken, then accepts in-viewport events', async () => {
    const client = createMockClient();
    const bot = await hostBot(client, 'Lobo');
    await client.browserScreen(bot.id);

    await expect(client.browserInput(bot.id, { type: 'key', key: 'Enter' })).rejects.toThrow('409');

    expect(await client.getBrowserTakeover(bot.id)).toEqual({ active: false });
    const takeover = await client.setBrowserTakeover(bot.id, { active: true });
    expect(takeover).toMatchObject({ active: true });
    expect((await client.getBrowserTakeover(bot.id)).since).toBeTruthy();

    await expect(client.browserInput(bot.id, { type: 'click', x: 640, y: 400, button: 'left', double: false })).resolves.toBeUndefined();
    await expect(client.browserInput(bot.id, { type: 'type', text: 'hello' })).resolves.toBeUndefined();
    await expect(client.browserInput(bot.id, { type: 'click', x: 1280, y: 400, button: 'left', double: false })).rejects.toThrow('400');

    await client.setBrowserTakeover(bot.id, { active: false });
    await expect(client.browserInput(bot.id, { type: 'key', key: 'Enter' })).rejects.toThrow('409');
  });

  it('shares one takeover between the bots of a profile and clears it when the profile goes', async () => {
    const client = createMockClient();
    const a = await hostBot(client, 'A', 'profile_shared');
    const b = await hostBot(client, 'B', 'profile_shared');
    await client.browserScreen(a.id);

    await client.setBrowserTakeover(a.id, { active: true });
    expect(await client.getBrowserTakeover(b.id)).toMatchObject({ active: true });
    await expect(client.browserInput(b.id, { type: 'key', key: 'Tab' })).resolves.toBeUndefined();

    await client.deleteBrowserProfile('profile_shared');
    expect(await client.getBrowserTakeover(a.id)).toEqual({ active: false });
    expect(await client.getBrowserTakeover(b.id)).toEqual({ active: false });
  });

  it('refuses the takeover routes for a bot without a host browser', async () => {
    const client = createMockClient();
    await expect(client.getBrowserTakeover('bot_capy')).rejects.toThrow();
    await expect(client.setBrowserTakeover('bot_capy', { active: true })).rejects.toThrow();
    await expect(client.browserInput('bot_capy', { type: 'key', key: 'Enter' })).rejects.toThrow();
  });
});
