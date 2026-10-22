import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bot } from '@brot/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostBrowserService } from './types';
import { botFor } from './test-helpers';
import { BROWSER_TAKEOVER_REFUSAL, createHostBrowserService } from './service';

/** A bot that opted into the host browser (the tests that do not need the flag use `botFor`). */
function hostBotFor(id: string, allow?: readonly string[], browserProfileId?: string): Bot {
  return { ...botFor(id, allow, browserProfileId), browser: true };
}

const MISSING = '/nonexistent/brot-chrome';
const homes: string[] = [];
const services: HostBrowserService[] = [];

async function startService(): Promise<{ service: HostBrowserService; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'brot-browser-'));
  homes.push(home);
  const service = createHostBrowserService({ home, binary: MISSING });
  services.push(service);
  return { service, home };
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.closeAll()));
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('host browser service without a usable Chrome', () => {
  it('reports stopped before anything is started and closes idempotently', async () => {
    const { service } = await startService();
    const bot = botFor('bot_1');
    expect(await service.status(bot)).toEqual({ state: 'stopped' });
    await service.close(bot);
    await service.close(bot);
    expect(await service.status(bot)).toEqual({ state: 'stopped' });
    await service.closeAll();
    await service.closeAll();
    expect(await service.status(bot)).toEqual({ state: 'stopped' });
  });

  it('refuses a bot command clearly and leaves the bot stopped when the binary is missing', async () => {
    const { service } = await startService();
    const bot = botFor('bot_1', ['example.com']);
    await expect(service.browser(bot, 'open', { url: 'https://example.com' })).rejects.toThrow(/does not exist or is not executable/);
    expect(await service.status(bot)).toEqual({ state: 'stopped' });
  });

  it('refuses a login window the same way when the binary is missing', async () => {
    const { service } = await startService();
    const bot = botFor('bot_1');
    await expect(service.openForLogin(bot)).rejects.toThrow(new RegExp(MISSING));
    expect(await service.status(bot)).toEqual({ state: 'stopped' });
  });

  it('deletes the profile directory with the bot', async () => {
    const { service, home } = await startService();
    const bot = botFor('bot_1');
    const profile = join(home, 'browser-profiles', bot.id);
    await mkdir(profile, { recursive: true });
    await service.deleteProfile(bot);
    await service.deleteProfile(bot);
    await expect(stat(profile)).rejects.toThrow();
    await expect(service.status(bot)).resolves.toEqual({ state: 'stopped' });
  });

  it('keeps bots independent', async () => {
    const { service } = await startService();
    const first = botFor('bot_1');
    const second = botFor('bot_2');
    expect(await service.status(first)).toEqual({ state: 'stopped' });
    expect(await service.status(second)).toEqual({ state: 'stopped' });
  });

  it('reports one state for every bot that shares a profile', async () => {
    const { service } = await startService();
    const first = botFor('bot_1', ['example.com'], 'bp_shared');
    const second = botFor('bot_2', ['example.com'], 'bp_shared');
    expect(await service.status(first)).toEqual({ state: 'stopped' });
    expect(await service.status(second)).toEqual({ state: 'stopped' });
    expect(await service.statusForProfile('bp_shared')).toEqual({ state: 'stopped' });
  });

  it('leaves a shared profile directory alone when one of its bots is deleted', async () => {
    const { service, home } = await startService();
    const bot = botFor('bot_1', undefined, 'bp_shared');
    const shared = join(home, 'browser-profiles', 'bp_shared');
    await mkdir(shared, { recursive: true });

    await service.deleteProfile(bot);
    await service.deleteProfile(bot);
    expect((await stat(shared)).isDirectory()).toBe(true);
    expect(await service.status(bot)).toEqual({ state: 'stopped' });
  });

  it('deletes a shared profile directory through its own methods, idempotently', async () => {
    const { service, home } = await startService();
    const shared = join(home, 'browser-profiles', 'bp_shared');
    await mkdir(shared, { recursive: true });

    await service.closeProfile('bp_shared');
    expect(await service.statusForProfile('bp_shared')).toEqual({ state: 'stopped' });

    await service.deleteProfileDir('bp_shared');
    await service.deleteProfileDir('bp_shared');
    await expect(stat(shared)).rejects.toThrow();
    expect(await service.statusForProfile('bp_shared')).toEqual({ state: 'stopped' });
  });
});

describe('host browser takeover without a running Chrome', () => {
  it('starts with no takeover and shares one state across a profile', async () => {
    const { service } = await startService();
    const first = hostBotFor('bot_1', undefined, 'bp_shared_takeover');
    const second = hostBotFor('bot_2', undefined, 'bp_shared_takeover');

    expect(await service.browserTakeover(first)).toEqual({ active: false });

    const taken = await service.setBrowserTakeover(first, { active: true, reason: 'Sign in' }, 'user');
    expect(taken).toMatchObject({ active: true, reason: 'Sign in' });
    expect(Number.isNaN(new Date(taken.since ?? '').getTime())).toBe(false);
    expect(await service.browserTakeover(second)).toMatchObject({ active: true, reason: 'Sign in' });

    await service.setBrowserTakeover(second, { active: false }, 'user');
    expect(await service.browserTakeover(first)).toEqual({ active: false });
  });

  it('refuses input without a takeover and checks the viewport before launching', async () => {
    const { service } = await startService();
    const bot = hostBotFor('bot_1');
    await expect(service.browserInput(bot, { type: 'move', x: 1, y: 1 })).rejects.toThrow(/No takeover is active/);

    await service.setBrowserTakeover(bot, { active: true }, 'user');
    await expect(service.browserInput(bot, { type: 'move', x: 5000, y: 1 })).rejects.toThrow(
      /outside the 1280x800 browser viewport/,
    );
    // Valid input needs a running browser: with none, the person is told to let the live view start it.
    await expect(service.browserInput(bot, { type: 'key', key: 'Tab' })).rejects.toThrow('The browser is not running.');
  });

  it('refuses live view and takeover for a bot without a browser', async () => {
    const { service } = await startService();
    const plain = botFor('bot_1');
    expect(plain.browser).toBeUndefined();
    await expect(service.browserScreen(plain)).rejects.toThrow('This bot has no browser');
    await expect(service.browserTakeover(plain)).rejects.toThrow('This bot has no browser');
    await expect(service.setBrowserTakeover(plain, { active: true }, 'user')).rejects.toThrow('This bot has no browser');
  });

  it('clears a profile takeover when its profile directory is deleted', async () => {
    const { service } = await startService();
    const bot = hostBotFor('bot_1', undefined, 'bp_shared_takeover');
    await service.setBrowserTakeover(bot, { active: true }, 'user');
    await service.deleteProfileDir('bp_shared_takeover');
    expect(await service.browserTakeover(bot)).toEqual({ active: false });
  });

  it('exposes the refusal text the bot sees while the person drives', () => {
    expect(BROWSER_TAKEOVER_REFUSAL).toBe('The person is in control of the browser; wait until they hand it back.');
  });
});
