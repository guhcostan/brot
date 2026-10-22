import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bot, CanonicalEvent } from '@brot/protocol';
import { foldEvents, pendingApprovals } from '../state/thread';
import { ScreenUnavailable, type BotEvent } from './client';
import { createMockClient } from './mockClient';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mock bot management', () => {
  it('creates, archives and deletes a bot', async () => {
    const client = createMockClient();
    const created = await client.createBot({ name: 'Lobo', job: 'Researcher', avatar: 'lobo:teal', computer: 'none' });
    expect(() => Bot.parse(created)).not.toThrow();
    expect((await client.listBots()).some((bot) => bot.id === created.id)).toBe(true);

    await client.updateBot(created.id, { archived: true });
    expect((await client.listBots()).some((bot) => bot.id === created.id)).toBe(false);
    expect((await client.listBots({ includeArchived: true })).some((bot) => bot.id === created.id)).toBe(true);

    await client.deleteBot(created.id);
    expect((await client.listBots({ includeArchived: true })).some((bot) => bot.id === created.id)).toBe(false);
  });

  it('removes a team budget with null', async () => {
    const client = createMockClient();
    const updated = await client.updateBot('bot_boto', { teamBudgetUsd: null });
    expect(updated.teamBudgetUsd).toBeUndefined();
  });

  it('adds and removes room members, but never the lead', async () => {
    const client = createMockClient();
    expect(await client.updateRoomMembers('room_week', { add: ['bot_mico'], remove: ['bot_sol'] })).toEqual(['bot_ara', 'bot_boto', 'bot_mico']);
    await expect(client.updateRoomMembers('room_week', { remove: ['bot_ara'] })).rejects.toThrow();
  });

  it('marks a provider configured once its key is stored', async () => {
    const client = createMockClient();
    await client.setSecret('DEEPSEEK_API_KEY', 'sk-test');
    expect((await client.listProviders()).find((provider) => provider.id === 'deepseek')?.configured).toBe(true);
  });
});

describe('mock computer', () => {
  it('serves a frame for a running desktop and refuses one that is stopped', async () => {
    const client = createMockClient();
    expect((await client.computerScreen('bot_boto')).type).toBe('image/svg+xml');
    const stopped = await client.computerScreen('bot_ara').catch((error: unknown) => error);
    expect(stopped).toBeInstanceOf(ScreenUnavailable);
    const headless = await client.computerScreen('bot_capy').catch((error: unknown) => error);
    expect((headless as ScreenUnavailable).status).toBe(404);
  });

  it('boots a stopped computer', async () => {
    const client = createMockClient();
    expect((await client.startComputer('bot_ara')).state).toBe('starting');
    await vi.advanceTimersByTimeAsync(2000);
    expect((await client.getComputer('bot_ara')).state).toBe('ready');
  });

  it('refuses input until the person takes control', async () => {
    const client = createMockClient();
    await expect(client.computerInput('bot_boto', { type: 'type', text: 'hi' })).rejects.toThrow();
    await client.setTakeover('bot_boto', { active: true });
    await expect(client.computerInput('bot_boto', { type: 'type', text: 'hi' })).resolves.toBeUndefined();
  });

  it('asks for a takeover at a sign-in and waits until control comes back', async () => {
    const client = createMockClient();
    const events: BotEvent[] = [];
    client.onEvent((event) => events.push(event));
    const araThread = (await client.listThreads('bot_ara'))[0];
    if (!araThread) throw new Error('bot_ara has no DM thread');
    await client.postMessage(araThread.id, { content: 'Post the release note on LinkedIn' });
    await vi.advanceTimersByTimeAsync(8000);

    const asked = events.find((entry) => entry.event.type === 'computer.takeover');
    expect(asked?.event.type === 'computer.takeover' && asked.event.takeover).toMatchObject({ active: true, requestedBy: 'bot' });
    expect(events.some((entry) => entry.event.type === 'run.completed')).toBe(false);

    await client.setTakeover('bot_ara', { active: true });
    await client.computerInput('bot_ara', { type: 'click', x: 640, y: 324, button: 'left', double: false });
    await client.computerInput('bot_ara', { type: 'type', text: 'me@example.com' });
    await client.computerInput('bot_ara', { type: 'key', key: 'Tab' });
    await client.computerInput('bot_ara', { type: 'type', text: 'pw' });
    await client.computerInput('bot_ara', { type: 'key', key: 'Return' });
    await client.setTakeover('bot_ara', { active: false });
    await vi.advanceTimersByTimeAsync(4000);

    for (const entry of events) expect(() => CanonicalEvent.parse(entry.event)).not.toThrow();
    const thread = foldEvents(events.filter((entry) => entry.botId === 'bot_ara').map((entry) => entry.event));
    expect(pendingApprovals(thread).map((item) => item.approval.kind)).toEqual(['publish']);
  });
});

describe('mock host browser', () => {
  const withBrowser = (client: ReturnType<typeof createMockClient>) =>
    client.createBot({ name: 'Lobo', job: 'Researcher', computer: 'none', browser: true });

  it('starts a new host browser stopped and opens the sign-in window', async () => {
    const client = createMockClient();
    const bot = await withBrowser(client);
    expect(await client.browserStatus(bot.id)).toEqual({ state: 'stopped' });
    expect(await client.startBrowserLogin(bot.id)).toEqual({ state: 'login' });
    expect(await client.browserStatus(bot.id)).toEqual({ state: 'login' });
  });

  it('closes the browser and keeps it stopped', async () => {
    const client = createMockClient();
    const bot = await withBrowser(client);
    await client.startBrowserLogin(bot.id);
    await expect(client.closeBrowser(bot.id)).resolves.toBeUndefined();
    expect(await client.browserStatus(bot.id)).toEqual({ state: 'stopped' });
  });

  it('refuses a bot without a browser and a sign-in window on a desktop bot', async () => {
    const client = createMockClient();
    await expect(client.browserStatus('bot_capy')).rejects.toThrow('409');
    const desktop = await client.createBot({ name: 'Ara', job: 'Posts', computer: 'sandbox', desktop: true, browser: true });
    expect(await client.browserStatus(desktop.id)).toEqual({ state: 'stopped' });
    await expect(client.startBrowserLogin(desktop.id)).rejects.toThrow('409');
  });

  it('forgets the browser state once the bot no longer has a browser', async () => {
    const client = createMockClient();
    const bot = await withBrowser(client);
    await client.startBrowserLogin(bot.id);
    await client.updateBot(bot.id, { browser: false });
    await expect(client.browserStatus(bot.id)).rejects.toThrow('409');
  });
});
