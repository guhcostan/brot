import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
});
