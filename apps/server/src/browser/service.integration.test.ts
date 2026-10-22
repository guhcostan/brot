import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Bot } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { runBrowserCommand } from './driver';
import { createBotEgress } from './egress';
import { launchChrome, resolveChromeBinary, type ChromeHandle } from './launch';
import { ensureProfileDir, profileDir } from './profile';
import { createHostBrowserService } from './service';
import { botFor } from './test-helpers';
import type { HostBrowserService } from './types';

/** The suite launches the real Chrome on this machine; when there is none it skips instead of failing. */
function chromeInstalled(): boolean {
  try {
    resolveChromeBinary();
    return true;
  } catch {
    return false;
  }
}

const chromeFound = chromeInstalled();

async function startLocalServer(): Promise<{ server: Server; port: number; hits: () => number }> {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('LOOPBACK_MARKER');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  return { server, port: typeof address === 'object' && address !== null ? address.port : 0, hits: () => hits };
}

/** The Chrome process serving a profile, found by its `--user-data-dir`. Renderer helpers carry the same flag. */
function chromePid(profile: string): number | undefined {
  const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  for (const line of output.split('\n')) {
    if (!line.includes(profile) || line.includes('--type=')) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return undefined;
}

async function waitForStopped(service: HostBrowserService, bot: Bot): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if ((await service.status(bot)).state === 'stopped') return;
    if (Date.now() >= deadline) throw new Error('the browser did not report stopped after the crash');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(!chromeFound)('host browser against the real Chrome', () => {
  it(
    'opens an allowlisted site through the egress proxy and refuses blocked hosts and loopback',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'brot-browser-'));
      const service = createHostBrowserService({ home });
      const local = await startLocalServer();
      const bot = botFor(`bot_it_${Date.now()}`, ['example.com']);
      try {
        expect(await service.status(bot)).toEqual({ state: 'stopped' });

        const opened = await service.browser(bot, 'open', { url: 'https://example.com' });
        expect(String(opened.title)).toBe('Example Domain');
        expect(String(opened.url)).toContain('example.com');
        expect(await service.status(bot)).toEqual({ state: 'running' });

        const snapshot = await service.browser(bot, 'snapshot', {});
        const snapshotText = String(snapshot.text);
        expect(String(snapshot.title)).toBe('Example Domain');
        // IANA removed the "Example Domain" heading from the page body, so the phrase now lives in the title.
        expect(`${String(snapshot.title)} ${snapshotText}`).toContain('Example Domain');
        expect(snapshotText.trim()).not.toBe('');

        // The field command reads the page too: it must resolve on a real ref, not fail inside the page.
        const ref = /\[ref=(\d+)\]/.exec(snapshotText);
        expect(ref).not.toBeNull();
        if (ref === null) throw new Error('the snapshot tagged no interactive element');
        const field = await service.browser(bot, 'field', { ref: Number(ref[1]) });
        expect(typeof field.tag).toBe('string');
        expect(typeof field.sensitive).toBe('boolean');
        // A missing ref is the normal "take a new snapshot" refusal, not a `ReferenceError` from the page.
        await expect(service.browser(bot, 'field', { ref: 999_999 })).rejects.toThrow(/that ref is not on the page/);

        // A host outside the allowlist is refused; the browser keeps its page.
        await expect(service.browser(bot, 'open', { url: 'https://www.google.com' })).rejects.toThrow(
          /www\.google\.com is not on this bot's egress allowlist/,
        );

        // Loopback is refused too: Chrome must never reach the local server directly (it would if not proxied).
        await expect(service.browser(bot, 'open', { url: `http://127.0.0.1:${local.port}/` })).rejects.toThrow(
          /127\.0\.0\.1 is not on this bot's egress allowlist/,
        );
        expect(local.hits()).toBe(0);

        const stillThere = await service.browser(bot, 'snapshot', {});
        expect(String(stillThere.title)).toBe('Example Domain');
      } finally {
        await service.closeAll();
        await new Promise<void>((resolve) => local.server.close(() => resolve()));
        await rm(home, { recursive: true, force: true });
      }
      expect(await service.status(bot)).toEqual({ state: 'stopped' });
    },
    180_000,
  );

  it(
    'sends every request through the proxy, loopback included',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'brot-browser-'));
      const local = await startLocalServer();
      const egress = await createBotEgress(botFor('bot_it_proxy', ['example.com']));
      let handle: ChromeHandle | undefined;
      try {
        const profile = await ensureProfileDir(home, 'bot_it_proxy');
        handle = await launchChrome(resolveChromeBinary(), { profile, proxyPort: egress.port });
        // The driver is told these hosts are fine, so only the browser's proxy can refuse them. A stored policy
        // cannot list an IP address; the bot is built this way only to keep the fast refusal out of the way.
        const bot = botFor('bot_it_proxy', ['www.google.com', '127.0.0.1']);
        // Chrome reached the proxy for https: the proxy refused CONNECT, instead of Chrome loading the site.
        await expect(
          runBrowserCommand(handle.browser, bot, 'open', { url: 'https://www.google.com' }),
        ).rejects.toThrow(/ERR_TUNNEL_CONNECTION_FAILED/);
        // And loopback: without the proxy-bypass override Chrome would load this page straight from the server.
        await expect(
          runBrowserCommand(handle.browser, bot, 'open', { url: `http://127.0.0.1:${local.port}/` }),
        ).rejects.toThrow(/net::|ERR_/);
        expect(local.hits()).toBe(0);
      } finally {
        await handle?.close();
        await egress.close();
        await new Promise<void>((resolve) => local.server.close(() => resolve()));
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it.skipIf(process.platform === 'win32')(
    'reaps a crashed Chrome and starts a fresh one on the next command',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'brot-browser-'));
      const service = createHostBrowserService({ home });
      const bot = botFor(`bot_crash_${Date.now()}`, ['example.com']);
      try {
        await service.browser(bot, 'open', { url: 'https://example.com' });
        expect(await service.status(bot)).toEqual({ state: 'running' });
        const pid = chromePid(profileDir(home, bot.id));
        if (pid === undefined) throw new Error('the test could not find the Chrome process to kill');
        process.kill(pid, 'SIGKILL');
        await waitForStopped(service, bot);
        // The next command starts a new Chrome on the same profile instead of failing forever.
        const reopened = await service.browser(bot, 'open', { url: 'https://example.com' });
        expect(String(reopened.title)).toBe('Example Domain');
        expect(await service.status(bot)).toEqual({ state: 'running' });
      } finally {
        await service.closeAll();
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it(
    'shares one Chrome between the bots that name the same profile',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'brot-browser-'));
      const service = createHostBrowserService({ home });
      const profileId = 'bp_it_shared_browse';
      const first = botFor(`bot_shared_a_${Date.now()}`, ['example.com'], profileId);
      const second = botFor(`bot_shared_b_${Date.now()}`, ['example.com'], profileId);
      try {
        await service.browser(first, 'open', { url: 'https://example.com' });
        expect(await service.status(first)).toEqual({ state: 'running' });
        expect(await service.status(second)).toEqual({ state: 'running' });

        // The second bot reads the page the first one opened: the profile has one Chrome, not one per bot.
        const snapshot = await service.browser(second, 'snapshot', {});
        expect(String(snapshot.title)).toBe('Example Domain');

        // Closing through either bot closes that profile's browser for everyone in it.
        await service.close(second);
        expect(await service.status(first)).toEqual({ state: 'stopped' });
        expect(await service.statusForProfile(profileId)).toEqual({ state: 'stopped' });
      } finally {
        await service.closeAll();
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it(
    'restarts a shared profile Chrome when another bot has a different egress policy',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'brot-browser-'));
      const service = createHostBrowserService({ home });
      const profileId = 'bp_it_shared_egress';
      const first = botFor(`bot_egress_a_${Date.now()}`, ['example.com'], profileId);
      const second = botFor(`bot_egress_b_${Date.now()}`, ['www.google.com'], profileId);
      try {
        await service.browser(first, 'open', { url: 'https://example.com' });
        expect(String((await service.browser(first, 'snapshot', {})).title)).toBe('Example Domain');

        // A different allowlist restarts the profile's Chrome through the second bot's proxy; the page is gone
        // but the profile directory (cookies, logins) survives the restart.
        const restarted = await service.browser(second, 'snapshot', {});
        expect(String(restarted.title)).not.toBe('Example Domain');
        expect(await service.status(second)).toEqual({ state: 'running' });
        await expect(service.browser(second, 'open', { url: 'https://example.com' })).rejects.toThrow(
          /not on this bot's egress allowlist/,
        );

        // The first bot's command restarts it back under its own policy.
        const again = await service.browser(first, 'open', { url: 'https://example.com' });
        expect(String(again.title)).toBe('Example Domain');
        expect((await stat(join(home, 'browser-profiles', profileId))).isDirectory()).toBe(true);
      } finally {
        await service.closeAll();
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it(
    'destroys only an own profile when its bot is deleted, and leaves a shared one',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'brot-browser-'));
      const service = createHostBrowserService({ home });
      const sharedId = 'bp_it_delete_shared';
      const sharedBot = botFor(`bot_delete_shared_${Date.now()}`, ['example.com'], sharedId);
      const ownBot = botFor(`bot_delete_own_${Date.now()}`, ['example.com']);
      try {
        await service.browser(sharedBot, 'open', { url: 'https://example.com' });
        await service.deleteProfile(sharedBot);
        // A shared profile outlives any one bot: its browser and directory are untouched.
        expect(await service.status(sharedBot)).toEqual({ state: 'running' });
        expect((await stat(join(home, 'browser-profiles', sharedId))).isDirectory()).toBe(true);

        await service.browser(ownBot, 'open', { url: 'https://example.com' });
        await service.deleteProfile(ownBot);
        await service.deleteProfile(ownBot);
        expect(await service.status(ownBot)).toEqual({ state: 'stopped' });
        await expect(stat(join(home, 'browser-profiles', ownBot.id))).rejects.toThrow();
      } finally {
        await service.closeAll();
        await rm(home, { recursive: true, force: true });
      }
    },
    180_000,
  );
});